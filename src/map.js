/**
 * Utils for generating and manipulating import maps
 */
import { Generator } from "@jspm/generator";

export class ImportMap {
	constructor ({ mode, ...generatorOptions } = {}) {
		if (mode) {
			generatorOptions.env ??= [mode, "browser", "module"];
		}

		this.generator = new Generator({
			defaultProvider: "nodemodules",
			env: ["production", "browser", "module"],
			flattenScopes: false,
			...generatorOptions,
		});
	}

	async install (alias, target = `./node_modules/${alias}`) {
		try {
			return await this.generator.install({
				alias,
				target,
				subpaths: true,
			});
		}
		catch (error) {}
	}

	getMap () {
		let map = this.generator.getMap();
		cleanupScopes(map);
		return map;
	}
}

/**
 * This function processes map.scopes and does the following:
 * 1. Removes redundant scopes, i.e. scopes that are identical to their parent
 * 2. Hoists specifiers to parent scopes if they would otherwise be undefined
 * @param {object} map
 * @returns {object} The cleaned up map
 */
export function cleanupScopes (map) {
	if (!map?.scopes) {
		return map;
	}

	map.imports ??= {};

	// Sort scopes in ascending order of length
	let scopes = Object.keys(map.scopes).sort((a, b) => a.length - b.length);
	let scopesSeen = [];

	for (let scope of scopes) {
		let parentScopes = scopesSeen.filter(s => scope.startsWith(s) && map.scopes[s]).reverse();
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

	return map;
}

// prettier-ignore
export function injectMap () {
	if (!cS) {
		return console.error(`Import map injection script cannot be included as a module script. Please remove type="module".`);
	}
	else if (document.querySelector(`script[type=module]`)) {
		return console.error(`${cS.getAttribute("src")} must be included before any module scripts.`);
	}

	const mapUrl = cS.src;
	const rebase = m => { for (let k in m) m[k] = new URL(m[k], mapUrl).href; return m; };
	rebase(map.imports);
	for (let scope in map.scopes) rebase(map.scopes[scope]);
	cS.after(Object.assign(document.createElement("script"), { type: "importmap", textContent: JSON.stringify(map) }));
}

export async function getImportMapJs (map) {
	let stringified = typeof map === "string" ? map : JSON.stringify(map, null, "\t");
	return `{
let map = ${stringified};
let cS = document.currentScript;
(${injectMap})();
}`;
}

export function walkMap (map, callback) {
	if (!map) {
		return;
	}

	if (map.imports) {
		for (let specifier in map.imports) {
			callback({
				specifier,
				path: map.imports[specifier],
				map: map.imports,
			});
		}
	}

	if (map.scopes) {
		for (let scope in map.scopes) {
			for (let specifier in map.scopes[scope]) {
				let subMap = map.scopes[scope];
				callback({
					specifier,
					path: subMap[specifier],
					map: subMap,
					scope,
				});
			}
		}
	}
}

export function applyOverrides (map, overrides) {
	return deepAssign(map, overrides);
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
