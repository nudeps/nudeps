import { Generator } from "@jspm/generator";
import { readJSONSync } from "./util.js";

export async function getImportMap ({ inputMap, prune, exclude } = {}) {
	const generator = new Generator({
		inputMap,
		mapUrl: ".",
		defaultProvider: "nodemodules",
		env: ["production", "browser", "module"],
	});

	const pkg = readJSONSync("./package.json");

	if (!pkg) {
		throw new Error("package.json not found or invalid");
	}

	// Install from a local package:
	await installPackage(generator, pkg.name, "./");

	if (!prune && pkg.dependencies) {
		exclude = new Set(exclude ?? []);

		let lastPruneDeps = readJSONSync(".nudeps/package.json")?.dependencies ?? {};

		for (const dep in pkg.dependencies) {
			if (exclude.has(dep) || lastPruneDeps[dep]) {
				continue;
			}

			// --- Option 1 ---
			await installPackage(generator, dep, `./node_modules/${dep}`);

			// --- Option 2 (gives different import map!) ---
			// With nodemodules provider, use package name, not path
			// await installPackage(generator, dep, dep);
		}
	}

	// Output the import map:
	let map = generator.getMap();

	if (map.imports && map.scopes["./"]) {
		// Remove redundant scoped imports
		for (let specifier in map.scopes["./"]) {
			if (map.imports[specifier] === map.scopes["./"][specifier]) {
				delete map.scopes["./"][specifier];
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

const injectMapCode = injectMap.toString();

export async function getImportMapJs (map) {
	map ??= await getImportMap();
	let stringified = typeof map === "string" ? map : JSON.stringify(map, null, "\t");
	return `{let map = ${stringified};\n(${injectMapCode})(map, document.currentScript)}`;
}

async function installPackage (generator, name, target) {
	try {
		return await generator.install({
			alias: name,
			target: target,
			subpaths: true,
		});
	}
	catch (error) {}
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
				type: "imports",
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
					type: "scopes",
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
