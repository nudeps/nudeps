import { Generator } from "@jspm/generator";
import { readJSONSync } from "./util.js";

export async function getImportMap ({ inputMap, prune, exclude } = {}) {
	const generator = new Generator({
		inputMap,

		// The URL of the import map, for normalising relative URLs:
		mapUrl: ".",

		// The default CDN to use for external package resolutions:
		defaultProvider: "nodemodules",

		// The environment(s) to target. Note that JSPM will use these to resolve
		// conditional exports in any package it encounters:
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
	return generator.getMap();
}

// prettier-ignore
export function injectMap (map) {
	let { currentScript: cS } = document;
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

const injectMapName = injectMap.name;
const injectMapCode = injectMap.toString();

export async function getImportMapJs (map) {
	map ??= await getImportMap();
	let stringified = typeof map === "string" ? map : JSON.stringify(map, null, "\t");
	return `(()=>{${injectMapName}(${stringified});

${injectMapCode}})();`;
}

async function installPackage (generator, name, target) {
	try {
		return await generator.install({
			alias: name,
			target: target,
			subpaths: true,
		});
	}
	catch (error) {
		try {
			return await generator.install({
				alias: name,
				target: target,
				subpaths: false,
			});
		}
		catch (e) {
			// console.error(e);
		}
	}
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
