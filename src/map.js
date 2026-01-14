import { Generator } from "@jspm/generator";
import { ImportMap } from "@jspm/import-map";
import { readFileSync } from "node:fs";
import { readJSONSync } from "./util.js";

// These help us parse an importmap JS and extract the actual import map JSON
const COMMENT_START = "/* importmap start */";
const COMMENT_END = "/* importmap end */";

export async function getImportMap ({ inputMap, prune, exclude } = {}) {
	const generator = new Generator({
		// inputMap,

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
		exclude = new Set(exclude);
		for (const dep in pkg.dependencies) {
			if (exclude.has(dep)) {
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

export async function getImportMapJs (map) {
	map ??= await getImportMap();
	let stringified = typeof map === "string" ? map : JSON.stringify(map, null, "\t");
	return `(map => {
		let script = document.createElement("script");
		script.type = "importmap";
		script.textContent = JSON.stringify(map);
		document.currentScript.after(script);
	})(
		${COMMENT_START}${stringified}${COMMENT_END},
	);`;
}

export function readImportMap ({ map = "importmap.js" } = {}) {
	let contents = readFileSync(map, "utf8");
	if (!contents.includes(COMMENT_START) || !contents.includes(COMMENT_END)) {
		throw new Error("Malformed import map");
	}

	let start = contents.indexOf(COMMENT_START) + COMMENT_START.length;
	let end = contents.lastIndexOf(COMMENT_END);
	let importMap = contents.slice(start, end);
	let mapJson = JSON.parse(importMap);
	return new ImportMap({ map: mapJson });
}

export function getPaths (map) {
	let rootPaths = map.imports ? Object.values(map.imports) : [];
	let scopePaths = map.scopes ? Object.values(Object.assign(...Object.values(map.scopes))) : [];
	return new Set([...rootPaths, ...scopePaths]);
}

export function getTopLevelDirectories (map) {
	let paths = [...getPaths(map)];
	// No g flag is intentional: we want the first match!
	let dirs = paths
		.map(path => path.match(/(?<=node_modules\/)@[\w-.]+\/[\w-.]+/)?.[0])
		.filter(Boolean);
	return new Set(dirs);
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
