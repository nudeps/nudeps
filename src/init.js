import * as path from "node:path";
import { getConfig } from "./config.js";
import {
	readJSONSync,
	writeJSONSync,
	extractTopLevelPackage,
	extractPackageLockKey,
	extractTopLevelDirectory,
	getTopLevelModules,
} from "./util.js";
import { writeFileSync, renameSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { cp } from "node:fs/promises";
import { getImportMap, getImportMapJs } from "./map.js";

function processMap (map, toCopy, packages) {
	if (map) {
		for (let specifier in map) {
			let url = map[specifier];
			let topLevelPackage = extractTopLevelPackage(url);
			let topLevelDir = extractTopLevelDirectory(url);
			let key = extractPackageLockKey(url);
			if (!key) {
				continue;
			}

			let version = packages?.[key]?.version;
			version = version ? "@" + version : "";
			let rewritten = topLevelPackage + version;
			map[specifier] = url.replace(topLevelDir, rewritten);

			toCopy[topLevelPackage] ??= rewritten;
			if (!toCopy[topLevelPackage]) {
				toCopy("./node_modules/" + topLevelPackage, rewritten, {
					recursive: true,
				});
			}
		}
	}
}

export default async function init () {
	let config = await getConfig();
	let oldConfig = readJSONSync(".nudeps/config.json");

	if (!existsSync(".nudeps")) {
		// First run
		mkdirSync(".nudeps");
		writeFileSync(".nudeps/.gitignore", "*");
	}
	else if (oldConfig) {
		if (config.dir !== oldConfig.dir && existsSync(oldConfig.dir)) {
			renameSync(oldConfig.dir, config.dir);
			// TODO update .gitignore?
		}
	}

	// Remove old import map
	let oldMap = oldConfig?.map ?? config.map;
	if (oldMap && existsSync(oldMap)) {
		rmSync(oldMap);
	}

	writeJSONSync(".nudeps/config.json", config);

	let map = await getImportMap({ prune: config.prune, exclude: config.exclude });
	let packages = readJSONSync("package-lock.json")?.packages;

	if (!existsSync(config.dir)) {
		mkdirSync(config.dir, { recursive: true });
		writeFileSync(path.join(config.dir, ".gitignore"), "*");
	}

	// Extract top-level directories, copy them over to config.dir
	// using the package version at the end of the directory (e.g. @foo/bar@3.1.2 instead of @foo/bar)
	// and update the import map to use that directory instead
	let toCopy = {};

	processMap(map.imports, toCopy, packages);

	if (map.scopes) {
		for (let scope in map.scopes) {
			processMap(map.scopes[scope], toCopy, packages);
		}
	}

	let existingDirs = new Set(getTopLevelModules(config.dir));
	let toDelete = new Set(existingDirs);

	for (let topLevelPackage in toCopy) {
		let targetDir = toCopy[topLevelPackage];
		if (existingDirs.has(targetDir)) {
			toDelete.delete(targetDir);
		}
		else {
			let from = "./node_modules/" + topLevelPackage;
			let to = config.dir + "/" + targetDir;
			cp(from, to, { recursive: true });
		}
	}

	for (let dir of toDelete) {
		rmSync(config.dir + "/" + dir, { recursive: true });
	}

	let js = await getImportMapJs(map);
	writeFileSync(config.map, js);

	// Prepare for `nudeps update`
	// intentionally async.
	// Nothing hinges on the result of this, and we're not going to run update immediately after.
	cp("package.json", ".nudeps/package.json");
	cp("package-lock.json", ".nudeps/package-lock.json");
}
