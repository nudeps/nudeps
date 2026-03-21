/**
 * Utils for generating and manipulating import maps
 */
import { Generator } from "@jspm/generator";

import { deepAssign, getNodeBuiltins } from "./util.js";
import { findOverride } from "./util/jspm-overrides.js";

export class ImportMapGenerator extends Generator {
	/**
	 * @param {object} [options]
	 * @param {object} [options.installCache] - Per-package cache map (mutated on miss), or null
	 * @param {import("../nudeps.js").default} [options.nudeps] - Nudeps instance for lock data access
	 */
	constructor ({ mode, installCache, nudeps, ...generatorOptions } = {}) {
		if (mode) {
			this.mode = mode;
			generatorOptions.env ??= [mode, "browser", "module"];
		}

		let commonJS = generatorOptions.commonJS ?? true;

		super({
			defaultProvider: "nodemodules",
			env: ["production", "browser", "module"],
			flattenScopes: false,
			combineSubpaths: false,
			commonJS: true,
			ignore: getNodeBuiltins(),
			...generatorOptions,
		});

		this.commonJS = commonJS;
		this.installCache = installCache ?? null;
		this.nudeps = nudeps ?? null;
		this.mapsToMerge = [];
		this.staleCacheKeys = new Set(Object.keys(installCache ?? {}));
		this.stats = { cacheHits: 0, cacheMisses: 0 };
		// Save options for creating temp generators on cache miss
		this._options = { mode, nudeps, ...generatorOptions };

		// Apply JSPM community overrides (client-side equivalent of what jspm.io CDN does server-side)
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
	}

	get provider () {
		return this.traceMap.resolver.pm;
	}

	async install (alias, target = `./node_modules/${alias}`, { noRetry, ...installOptions } = {}) {
		// Check if this install is cacheable:
		// must have a cache, not be the root package ("."), and not be a symlink (local dep)
		let pkg = this.nudeps && target !== "." ? this.nudeps.packages.parse(target).pkg : null;
		let shouldCache = this.installCache && pkg?.version && !pkg.isExternal;
		let cacheKey = shouldCache ? this.nudeps.localDir(pkg) : null;

		// Cache hit — skip JSPM entirely
		if (shouldCache && cacheKey in this.installCache) {
			this.stats.cacheHits++;
			this.staleCacheKeys.delete(cacheKey);
			this.mapsToMerge.push(this.installCache[cacheKey]);
			return;
		}

		// Cache miss — resolve on a temporary generator and capture the result
		if (shouldCache) {
			this.stats.cacheMisses++;
			let tempGen = new ImportMapGenerator(this._options);
			await tempGen.install(alias, target, { noRetry, ...installOptions });
			await tempGen.finalize();

			let depMap = tempGen.getMap();
			this.installCache[cacheKey] = depMap;
			this.mapsToMerge.push(depMap);
			return;
		}

		// Not cacheable (root package, symlink, etc.): install on this generator
		try {
			return await super.install({
				alias,
				target,
				subpaths: true,
				...installOptions,
			});
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
				console.warn(`[nudeps] Failed to trace subpaths for ${alias}: ${error.message}.`);
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
			this.getEntries(e => e?.format === "esm")
				.map(([url]) => this.nudeps.packages.parse(url).pkg?.name),
		);
		let cjsEntries = this.getEntries(e => e?.format === "commonjs")
			.filter(([url]) => !esmPackages.has(this.nudeps.packages.parse(url).pkg?.name));

		if (cjsEntries.length === 0) {
			return;
		}

		// Find cjs-browser-shim in the lockfile — prefer the user's own copy (shallowest).
		// If not found, look for it under nudeps' own node_modules.
		let { packages } = this.nudeps;
		let shimPkg = packages.getAll("cjs-browser-shim")[0];
		let shimPath = shimPkg?.path;
		if (!shimPath) {
			let nudepsPkg = packages.getAll("nudeps")[0];
			shimPath = nudepsPkg
				? nudepsPkg.path + "/node_modules/cjs-browser-shim"
				: "./node_modules/cjs-browser-shim";
		}
		await this.install("cjs-browser-shim", shimPath, { noRetry: true });

		let cjsPackages = [...new Set(cjsEntries.map(([url]) => packages.parse(url).pkg?.name))];
		let directCjsDeps = cjsPackages.filter(
			name => name in (this.nudeps.pkg.dependencies ?? {}),
		);

		let requireMsg = "";
		if (directCjsDeps.length > 0) {
			requireMsg = `Use require() to import these packages: ${directCjsDeps.join(", ")}.`;
		}
		this.nudeps.info(
			`${cjsPackages.length} CommonJS packages detected, adding cjs-browser-shim. ${requireMsg} Disable with --cjs=false`,
		);
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
	 * Flat set of all URL values in the map, used to exempt explicitly-exported files from
	 * ignore patterns. Only exact URL matches are checked — directory/prefix exports
	 * (e.g. "pkg/": "./client_modules/pkg@v/") are not covered and may still be ignored.
	 */
	get exportedUrls () {
		let urls = new Set([...this].map(({ url }) => url));
		Object.defineProperty(this, "exportedUrls", { value: urls, configurable: true });
		return urls;
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
		ret = ["(()=>{", ret, "})();"].join(lf);
		return ret;
	}
}
