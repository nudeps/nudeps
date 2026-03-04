/**
 * Utils for generating and manipulating import maps
 */
import { Generator } from "@jspm/generator";
import { readFileSync, globSync } from "node:fs";
import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { deepAssign } from "./util.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class ImportMapGenerator extends Generator {
	constructor ({ mode, ...generatorOptions } = {}) {
		if (mode) {
			this.mode = mode;
			generatorOptions.env ??= [mode, "browser", "module"];
		}

		let commonJS = generatorOptions.commonJS ?? true;

		super({
			defaultProvider: "nodemodules",
			env: ["production", "browser", "module"],
			flattenScopes: false,
			combineSubpaths: "both",
			commonJS: true,
			ignore: getNodeBuiltins(),
			...generatorOptions,
		});

		this.commonJS = commonJS;
	}

	get provider () {
		return this.traceMap.resolver.pm;
	}

	async install (alias, target = `./node_modules/${alias}`, { noRetry, ...installOptions } = {}) {
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

	getEntries (fn) {
		const resolver = this.traceMap?.resolver;

		if (resolver?.traceEntries) {
			return Object.entries(resolver.traceEntries).filter(([_, entry]) => fn(entry));
		}

		return [];
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
		ret = ["(()=>{", ret, "})();"].join(lf);
		return ret;
	}
}

let nodeBuiltins = null;
function getNodeBuiltins () {
	nodeBuiltins ??= Array.from(
		new Set(
			builtinModules.flatMap(mod =>
				mod.startsWith("node:") ? [mod, mod.slice(5)] : [mod, `node:${mod}`]),
		),
	);
	return nodeBuiltins;
}
