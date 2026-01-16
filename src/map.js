import { Generator } from "@jspm/generator";

export class ImportMap {
	constructor ({ inputMap } = {}) {
		this.inputMap = inputMap;
		this.generator = new Generator({
			inputMap,
			mapUrl: ".",
			defaultProvider: "nodemodules",
			env: ["production", "browser", "module"],
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
		return this.generator.getMap();
	}
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

const injectMapCode = injectMap.toString();

export async function getImportMapJs (map) {
	let stringified = typeof map === "string" ? map : JSON.stringify(map, null, "\t");
	return `{let map = ${stringified};\n(${injectMapCode})(map, document.currentScript)}`;
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
