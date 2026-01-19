/**
 * Utils for generating and manipulating import maps
 */
import { Generator } from "@jspm/generator";
import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
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
			commonJS: true,
			ignore: getNodeBuiltins(),
			...generatorOptions,
		});

		this.commonJS = commonJS;
	}

	async install (alias, target = `./node_modules/${alias}`) {
		try {
			return await super.install({
				alias,
				target,
				subpaths: true,
			});
		}
		catch (error) {
			console.error(`Error installing ${alias}: ${error.message}`);
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

	get hasCJS () {
		const resolver = this.generator?.traceMap?.resolver;
		let found = false;

		if (resolver?.traceEntries) {
			for (const url in resolver.traceEntries) {
				const entry = resolver.traceEntries[url];
				if (entry?.format === "commonjs") {
					found = true;
					break;
				}
			}
		}

		// Cache the result
		Object.defineProperty(this, "hasCJS", { value: found });
		return found;
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

	walk (callback) {
		let map = this.map;
		if (map.imports) {
			for (let specifier in map.imports) {
				callback.call(this, {
					specifier,
					url: map.imports[specifier],
					map: map.imports,
				});
			}
		}

		if (map.scopes) {
			for (let scope in map.scopes) {
				for (let specifier in map.scopes[scope]) {
					let subMap = map.scopes[scope];
					callback.call(this, {
						specifier,
						url: subMap[specifier],
						map: subMap,
						scope,
					});
				}
			}
		}
	}

	applyOverrides (overrides) {
		return deepAssign(this.map, overrides);
	}

	get js () {
		let injectMap = readFileSync(path.join(__dirname, "inject-map.js"));
		let cjsShim =
			this.commonJS !== false && this.hasCJS
				? "\n" + readFileSync(path.join(__dirname, "cjs-shim.js"))
				: "";
		return `(()=>{
let map = ${JSON.stringify(this.map, null, "\t")};
let cS = document.currentScript;
${injectMap}
${cjsShim}
})();`;
	}
}

function deepAssign (target, source) {
	if (!target) {
		target = {};
	}
	for (let key in source) {
		if (!target[key]) {
			target[key] = {};
		}

		if (typeof source[key] === "object" && source[key] !== null) {
			target[key] = deepAssign(target[key], source[key]);
		}
		else {
			target[key] = source[key];
		}

		if (target[key] === undefined) {
			delete target[key];
		}
	}

	return target;
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
