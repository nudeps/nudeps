import * as path from "node:path";
import { getConfig } from "./config.js";
import {
	readJSONSync,
	writeJSONSync,
	extractTopLevelPackage,
	extractPackageLockKey,
	extractTopLevelDirectory,
} from "./util.js";
import { writeFileSync, renameSync, existsSync, mkdirSync, rmSync, rmdirSync } from "node:fs";
import { cp } from "node:fs/promises";
import { getImportMap, getImportMapJs } from "./map.js";

export default async function init () {
	let config = await getConfig();
	let oldConfig = readJSONSync(".nudeps/config.json");

	if (!existsSync(".nudeps")) {
		// First run
		mkdirSync(".nudeps");
		writeFileSync(".nudeps/.gitignore", "*");
	}

	// Remove old import map
	rmSync(oldConfig?.map ?? config.map);

	// Remove old directory
	rmSync(oldConfig?.dir ?? config.dir, { recursive: true });

	writeJSONSync(".nudeps/config.json", config);

	let map = await getImportMap(config);
	let packages = readJSONSync("package-lock.json")?.packages;

	if (existsSync(config.dir)) {
		rmdirSync(config.dir);
	}
	mkdirSync(config.dir);

	// Extract top-level directories, copy them over to config.dir
	// using the package version at the end of the directory (e.g. @foo/bar@3.1.2 instead of @foo/bar)
	// and update the import map to use that directory instead
	let paths = {};

	function processMap (map) {
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
				let rewritten = config.dir + "/" + topLevelPackage + version;
				map[specifier] = url.replace(topLevelDir, rewritten);

				if (!paths[topLevelPackage]) {
					paths[topLevelPackage] = rewritten;
					cp("./node_modules/" + topLevelPackage, rewritten, {
						recursive: true,
					});
				}
			}
		}
	}

	processMap(map.imports);

	if (map.scopes) {
		for (let scope in map.scopes) {
			processMap(map.scopes[scope]);
		}
	}

	let js = await getImportMapJs(map);
	writeFileSync(config.map, js);

	// Prepare for `nudeps update`
	// intentionally async.
	// Nothing hinges on the result of this, and we're not going to run update immediately after.
	cp("package.json", ".nudeps/package.json");
	cp("package-lock.json", ".nudeps/package-lock.json");
}
