/**
 * Utils for generating and manipulating import maps
 */
import { readFileSync, statSync } from "node:fs";
import { Generator } from "@jspm/generator";

import { deepAssign, getNodeBuiltins } from "./util.js";
import { findOverride } from "./util/jspm-overrides.js";
import nudepsPkg from "../package.json" with { type: "json" };

/**
 * @import Nudeps from "./nudeps.js"
 */

// `require()` with a literal specifier: a string in one kind of quote, with no escape or
// interpolation inside. Computed specifiers (`require(name)`) cannot be traced, as with import().
// The callee is matched by name alone, which is also how JSPM reads CommonJS.
const REQUIRE_CALL = /(?<![\w$.])require\s*\(\s*(["'`])([^"'`\\$\n]+)\1\s*\)/g;

/**
 * The package a bare specifier names, e.g. `@scope/pkg` for `@scope/pkg/sub`.
 * @param {string} specifier
 * @returns {string}
 */
function packageName (specifier) {
	let depth = specifier.startsWith("@") ? 2 : 1;
	return specifier.split("/").slice(0, depth).join("/");
}

/**
 * @param {URL} url
 * @returns {boolean} Whether the URL is an existing file
 */
function isFile (url) {
	try {
		return statSync(url).isFile();
	}
	catch {
		return false;
	}
}

export class ImportMapGenerator extends Generator {
	/** Wildcard-expanded subpaths dropped from the map. */
	#skipped = new Set();

	/** Trace entries whose `require()` calls have been added to their deps. */
	#required = new WeakSet();

	/**
	 * @param {object} options
	 * @param {object} [options.installCache] - Per-package output map cache (mutated on miss), or null
	 * @param {Nudeps} options.nudeps - Nudeps instance for lock data access and logging
	 * @param {boolean} [options.silent] - Suppress user-facing log messages (for internal temp generators)
	 */
	constructor ({ installCache, silent, nudeps, ...generatorOptions }) {
		let commonJS = generatorOptions.commonJS ?? true;

		// nudeps provides the shim, so an entry point importing it must resolve through the
		// lockfile — a linked nudeps keeps it out of the project's node_modules (#159).
		let shim = nudeps.packages.get("cjs-browser-shim");

		super({
			defaultProvider: "nodemodules",
			resolutions: shim ? { "cjs-browser-shim": shim.path } : {},
			env: ["production", "browser", "module"],
			flattenScopes: false,
			combineSubpaths: false,
			commonJS: true,
			ignore: specifier => getNodeBuiltins().includes(specifier),
			...generatorOptions,
		});

		this.commonJS = commonJS;
		this.installCache = installCache ?? null;
		this.nudeps = nudeps;
		this.silent = silent ?? false;
		this.mapsToMerge = [];
		this.staleCacheKeys = new Set(Object.keys(installCache ?? {}));
		this.stats = { cacheHits: 0, cacheMisses: 0 };
		// installCache and silent are intentionally excluded from _options: installCache so that
		// temp generators always have null caches (preventing recursion); silent so that
		// sub-generators created on cache miss still produce user-facing log messages.
		this._options = { nudeps, ...generatorOptions };

		// Apply community overrides before JSPM resolves package configs
		// (client-side equivalent of what jspm.io CDN does server-side)
		let pm = this.provider;
		pm._getPackageConfig = pm.getPackageConfig;
		pm.getPackageConfig = async function (pkgUrl) {
			let pcfg = await pm._getPackageConfig(pkgUrl);
			if (pcfg?.name) {
				let override = findOverride(pcfg.name, pcfg.version);
				if (override) {
					Object.assign(pcfg, override);
				}
			}

			return pcfg;
		};

		// Wildcard expansion is speculative: `"./*": "./*"` exposes files the author never
		// promised are modules. JSPM skips the ones it can't resolve, but a file that fails to parse
		// as a module (e.g. an extensionless LICENSE) still aborts the whole install,
		// costing the package its real exports (#160).
		let tm = this.traceMap;
		let { visit } = tm;

		tm.visit = (specifier, opts, ...rest) => {
			let ret = visit.call(tm, specifier, opts, ...rest);
			// Only an enumerated subpath is both top-level and of unknown importer. JSPM leaves
			// it unpinned when its trace resolves to `undefined`.
			return opts.unknownImporter && opts.toplevel
				? ret?.catch(() => {
						this.#skipped.add(specifier);
					})
				: ret;
		};

		// JSPM parses a file as either ESM or CommonJS, so a `require()` in an ESM file — how
		// cjs-browser-shim loads CommonJS packages — is an edge it never sees, and `prune`, which
		// keeps only what the trace reaches, dropped those packages (#81). Upstream declined to trace
		// them (jspm/jspm#2752), so add them to the file's deps here; from then on JSPM resolves and
		// traces them like imports (a required .cjs file as CommonJS, its own requires included).
		// Only code written against the shim calls its require(): the project's files, and those of
		// packages depending on the shim. Any other package's `require()` is a Node-only path.
		// Only specifiers that resolve — an installed package, an existing file — are added, so a
		// stale `require()` in a comment can't fail the trace.
		let { resolver } = tm;
		let { _analyzeAsync } = resolver;

		resolver._analyzeAsync = async (url, ...rest) => {
			let entry = await _analyzeAsync.call(resolver, url, ...rest);

			if (entry?.format === "esm" && !this.#required.has(entry) && url.startsWith("file:")) {
				this.#required.add(entry);
				let { pkg } = this.nudeps.packages.parse(url);
				let usesShim = pkg
					? pkg.hasDependency("cjs-browser-shim")
					: !url.includes("/node_modules/");

				if (!usesShim) {
					return entry;
				}

				let source = readFileSync(new URL(url), "utf8");

				for (let [, , specifier] of source.matchAll(REQUIRE_CALL)) {
					let resolvable = /^\.\.?\//.test(specifier)
						? isFile(new URL(specifier, url))
						: this.nudeps.packages.has(packageName(specifier));

					if (resolvable && !entry.deps.includes(specifier)) {
						entry.deps.push(specifier);
					}
				}
			}

			return entry;
		};
	}

	get provider () {
		return this.traceMap.resolver.pm;
	}

	async install (alias, target, { noRetry, ...installOptions } = {}) {
		if (target === undefined) {
			// The lockfile knows where the dep really lives (nested deps, workspace prefix); guess otherwise.
			let prefix = this.nudeps.packages.prefix;
			target =
				this.nudeps.packages.get(alias)?.path ??
				`${prefix ? prefix + "/" : "./"}node_modules/${alias}`;
		}

		// Check if this install is cacheable:
		// must have a cache, not be the root package ("."), and not be a symlink (local dep)
		let pkg = target !== "." ? this.nudeps.packages.parse(target).pkg : null;
		let shouldCache = this.installCache && pkg?.version && !pkg.isExternal;
		let cacheKey = shouldCache ? this.nudeps.localDir(pkg) : null;

		if (shouldCache) {
			let outputMap = this.installCache[cacheKey];

			// Cache hit — skip JSPM entirely
			if (outputMap) {
				this.stats.cacheHits++;
				this.staleCacheKeys.delete(cacheKey);
				this.mapsToMerge.push(outputMap);
				return;
			}

			this.stats.cacheMisses++;

			// Generate output map with user's settings
			let outputGen = new ImportMapGenerator(this._options);
			await outputGen.install(alias, target, { noRetry, ...installOptions });
			await outputGen.finalize();
			outputMap = outputGen.getMap();
			this.installCache[cacheKey] = outputMap;

			this.staleCacheKeys.delete(cacheKey);
			this.mapsToMerge.push(outputMap);
			return;
		}

		// Not cacheable (root package, symlink, etc.): install on this generator
		this.#skipped.clear();
		try {
			let ret = await super.install({
				alias,
				target,
				subpaths: true,
				...installOptions,
			});

			let skipped = [...this.#skipped];
			if (skipped.length && !this.silent) {
				// One line per package, however many of its files fail to parse
				let rest = skipped.splice(3);
				this.nudeps.warn(
					`Skipped untraceable subpaths in ${alias}: ${skipped.join(", ")}${rest.length ? `, +${rest.length} more` : ""}.`,
				);
			}

			// Resolving nothing isn't an error to JSPM, so a package with neither `main` nor
			// `exports` — no subpaths to enumerate, implicit index.js gone with them — would
			// vanish silently. Subpath-only packages still report deps, so they don't retry.
			// Packages with no JS entry at all throw instead, and for them empty was right.
			// Not a redo: empty staticDeps means the first pass bailed before tracing anything,
			// and the retry runs on this same generator, so the resolver's caches carry over.
			if (!noRetry && !ret?.staticDeps?.length) {
				ret = await super
					.install({ alias, target, subpaths: false, ...installOptions })
					.catch(() => ret);
			}

			return ret;
		}
		catch (error) {
			if (noRetry) {
				throw error;
			}

			try {
				let ret = await super.install({
					alias,
					target,
					subpaths: false,
					...installOptions,
				});
				this.nudeps.warn(`Failed to trace subpaths for ${alias}: ${error.message}.`);
				return ret;
			}
			catch (retryError) {
				// Didn't help, just throw original error
				throw error;
			}
		}
	}

	/**
	 * Merge per-package cached maps with the generator's own map (root + non-cached installs).
	 */
	getMap () {
		let map = super.getMap();
		for (let cached of this.mapsToMerge) {
			deepAssign(map, cached);
		}
		return map;
	}

	getEntries (fn) {
		const resolver = this.traceMap?.resolver;

		if (resolver?.traceEntries) {
			return Object.entries(resolver.traceEntries).filter(([_, entry]) => fn(entry));
		}

		return [];
	}

	/**
	 * Finalize after all installs: install CJS shim if needed, prune stale cache entries.
	 */
	async finalize () {
		await this.#installCjsShim();

		// Prune stale cache entries (packages no longer encountered)
		for (let key of this.staleCacheKeys) {
			delete this.installCache[key];
		}
	}

	/**
	 * Install cjs-browser-shim if any CJS-only packages were newly resolved.
	 * Skips if the shim is already present from cached maps.
	 */
	async #installCjsShim () {
		if (this.commonJS === false) {
			return;
		}

		// Shim already present from cached maps — nothing to do
		if (this.mapsToMerge.some(m => m.imports?.["cjs-browser-shim"])) {
			return;
		}

		// Only flag packages as CJS if they have no ESM exports at all
		let esmPackages = new Set(
			this.getEntries(e => e?.format === "esm").map(
				([url]) => this.nudeps.packages.parse(url).pkg?.name,
			),
		);
		let cjsEntries = this.getEntries(e => e?.format === "commonjs").filter(
			([url]) => !esmPackages.has(this.nudeps.packages.parse(url).pkg?.name),
		);

		if (cjsEntries.length === 0) {
			return;
		}

		// install() resolves the shim's path from the lockfile — it's nudeps' own dependency.
		await this.install("cjs-browser-shim", undefined, { noRetry: true });

		let { packages } = this.nudeps;
		let cjsPackages = [...new Set(cjsEntries.map(([url]) => packages.parse(url).pkg?.name))];
		// directDependencies (not just pkg.dependencies) so a CJS package injected via
		// additionalDependencies is named in the require() hint too.
		let directDeps = new Set(this.nudeps.directDependencies);
		let directCjsDeps = cjsPackages.filter(name => directDeps.has(name));

		let requireMsg = "";
		if (directCjsDeps.length > 0) {
			requireMsg = `Use require() to import these packages: ${directCjsDeps.join(", ")}.`;
		}
		if (!this.silent) {
			this.nudeps.info(
				`${cjsPackages.length} CommonJS packages detected, adding cjs-browser-shim. ${requireMsg} Disable with --cjs=false`,
			);
		}
	}
}

export class ImportMap {
	constructor (generator) {
		this.generator = generator;
		this.map = generator.getMap() ?? {};
	}

	get imports () {
		return this.map.imports;
	}
	set imports (imports) {
		this.map.imports = imports;
	}

	get scopes () {
		return this.map.scopes;
	}
	set scopes (scopes) {
		this.map.scopes = scopes;
	}

	/**
	 * This function processes map.scopes and does the following:
	 * 1. Removes redundant scopes, i.e. scopes that are identical to their parent
	 * 2. Hoists specifiers to parent scopes if they would otherwise be undefined
	 * @param {object} map
	 * @returns {object} The cleaned up map
	 */
	cleanupScopes () {
		let map = this.map;
		if (!map?.scopes) {
			return map;
		}

		map.imports ??= {};

		// Sort scopes in ascending order of length
		let scopes = Object.keys(map.scopes).sort((a, b) => a.length - b.length);
		let scopesSeen = [];

		for (let scope of scopes) {
			let parentScopes = scopesSeen
				.filter(s => scope.startsWith(s) && map.scopes[s])
				.reverse();
			let parentMaps = parentScopes.map(s => map.scopes[s]);
			parentScopes.push("");
			parentMaps.push(map.imports);

			for (let specifier in map.scopes[scope]) {
				let parentMappingAt = parentMaps.findIndex(m => m[specifier]);
				let parentMapping =
					parentMappingAt > -1 ? parentMaps[parentMappingAt][specifier] : undefined;

				if (map.scopes[scope][specifier] === parentMapping) {
					// Redundant mapping that is identical to its parent
					delete map.scopes[scope][specifier];
				}
				else if (parentMappingAt === -1) {
					// No parent mapping, hoist to top scope
					map.imports[specifier] = map.scopes[scope][specifier];
					delete map.scopes[scope][specifier];
				}
			}
			if (Object.keys(map.scopes[scope]).length === 0) {
				delete map.scopes[scope];
			}

			scopesSeen.push(scope);
		}
	}

	*[Symbol.iterator] () {
		let map = this.map;
		if (map.imports) {
			for (let specifier in map.imports) {
				yield {
					specifier,
					url: map.imports[specifier],
					map: map.imports,
				};
			}
		}

		if (map.scopes) {
			for (let scope in map.scopes) {
				for (let specifier in map.scopes[scope]) {
					let subMap = map.scopes[scope];
					yield {
						specifier,
						url: subMap[specifier],
						map: subMap,
						scope,
					};
				}
			}
		}
	}

	applyOverrides (overrides) {
		return deepAssign(this.map, overrides);
	}

	/**
	 * Generate a self-contained JS script that injects the import map into the document.
	 * When `module` is true, uses `import.meta.url` for URL rebasing and appends to `<head>`.
	 * When false (default), uses `document.currentScript`.
	 * @param {object} options
	 * @param {boolean} [options.module=false] - Whether the script will be loaded as a module.
	 * @param {boolean} [options.terse=false] - Whether to lightly minify the output.
	 */
	toJS ({ module = false, terse = false } = {}) {
		let indent = terse ? "" : "\t";
		let lf = terse ? "" : "\n";
		let vars = {};
		vars.cS = "document.currentScript";
		vars.mapUrl = module ? "import.meta.url" : "cS?.src";
		vars.map = JSON.stringify(this.map, null, indent);

		let errors = "";

		if (!terse) {
			errors = /* js */ `
		if (!mapUrl && !cS) {
			throw new Error('nudeps: Import map script appears to be loaded as a module. Set module: true in nudeps config, or remove type="module" from the script tag.');
		}`;
			if (!module) {
				errors += /* js */ `
		if (document.querySelector("script[type=module]")) {
			console.warn("nudeps: " + cS.getAttribute("src") + " is included after module scripts, which is not supported in all browsers.");
		}`;
			}
		}

		let declarations = Object.entries(vars)
			.map(([key, value]) => `let ${key} = ${value};`)
			.join(lf);

		let ret = /* js */ `
		${errors}
		const rebase = m => { for (let k in m) m[k] = new URL(m[k], mapUrl).href; return m; };
		rebase(map.imports);
		for (let scope in map.scopes) rebase(map.scopes[scope]);
		let script = Object.assign(document.createElement("script"), { type: "importmap", textContent: JSON.stringify(map) });
		if (cS) cS.after(script);
		else (document.head ?? document.documentElement).append(script);`;

		ret = ret.replace(terse ? /^\t+/gm : /^\t{2}/gm, "").trim();
		ret = declarations + lf + ret;
		ret = [`(()=>{`, `/* Nudeps v${nudepsPkg.version} */`, ret, "})();"].join(lf);
		return ret;
	}
}
