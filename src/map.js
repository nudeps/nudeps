/**
 * Utils for generating and manipulating import maps
 */
import { Generator } from "@jspm/generator";

export class ImportMap {
	constructor ({ inputMap } = {}) {
		this.inputMap = inputMap;
		this.generator = new Generator({
			inputMap,
			defaultProvider: "nodemodules",
			env: ["production", "browser", "module"],
			flattenScopes: false,
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
		removeRedundantScopes(map);
		return map;
	}
}

export function removeRedundantScopes (map) {
	if (map && map.scopes && map.imports) {
		// Sort scopes in ascending order of length
		let scopes = Object.keys(map.scopes).sort((a, b) => a.length - b.length);
		let scopesSeen = [];

		for (let scope of scopes) {
			let parentMaps = scopesSeen.filter(s => scope.startsWith(s)).map(s => map.scopes[s]);
			parentMaps.unshift(map.imports);

			for (let specifier in map.scopes[scope]) {
				let parentMapping = parentMaps
					.map(m => m[specifier])
					.filter(Boolean)
					.pop();

				if (map.scopes[scope][specifier] === parentMapping) {
					delete map.scopes[scope][specifier];
				}
			}
			if (Object.keys(map.scopes[scope]).length === 0) {
				delete map.scopes[scope];
			}
		}
	}

	return map;
}

// prettier-ignore
export function injectMap (map, cS) {
	if (!cS) {
		console.error(`Import map injection script cannot be included as a module script. Please remove type="module".`);
	}
	else if (document.querySelector(`script[type=module]`)) {
		console.error(`${cS.getAttribute("src")} must be included before any module scripts.`);
	}
	else {
		cS.after(Object.assign(document.createElement("script"), { type: "importmap", textContent: JSON.stringify(map) }));
	}
}

export async function getImportMapJs (map) {
	let stringified = typeof map === "string" ? map : JSON.stringify(map, null, "\t");
	return `{let map = ${stringified};\n(${injectMap})(map, document.currentScript)}`;
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
