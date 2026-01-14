import * as path from "node:path";
import { getConfig } from "./config.js";
import { readJSONSync, writeJSONSync } from "./util.js";
import { writeFileSync, renameSync, existsSync, mkdirSync } from "node:fs";
import { cp } from "node:fs/promises";
import { getImportMap, getImportMapJs, getTopLevelDirectories } from "./map.js";

export default async function init () {
	let config = await getConfig();
	let oldConfig = readJSONSync(".nudeps/config.json");

	if (!existsSync(".nudeps")) {
		// First run
		mkdirSync(".nudeps");
		writeFileSync(".nudeps/.gitignore", "*");
	}
	else if (oldConfig) {
		// Check if any important settings changed
		if (config.map !== oldConfig.map && existsSync(oldConfig.map)) {
			// Rename old import map to new name
			renameSync(oldConfig.map, config.map);
		}

		if (config.dir !== oldConfig.dir && existsSync(oldConfig.dir)) {
			renameSync(oldConfig.dir, config.dir);
			// TODO update .gitignore?
		}

		// TODO handle changed exclude
		// TODO handle changed prune
	}

	writeJSONSync(".nudeps/config.json", config);

	let map = await getImportMap(config);
	let packages = readJSONSync("package-lock.json")?.packages;

	if (!existsSync(config.dir)) {
		mkdirSync(config.dir);
	}

	// Extract top-level directories, copy them over to config.dir
	// using the package version at the end of the directory (e.g. @foo/bar@3.1.2 instead of @foo/bar)
	// and update the import map to use that directory instead
	let paths = {};

	function processMap (map) {
		if (map) {
			for (let specifier in map) {
				let url = map[specifier];
				let match = url.match(/(^.+?node_modules\/)((?:@[\w-.]+\/)?[\w-.]+)/);
				if (!match) {
					continue;
				}
				let [whole, prefix, dir] = match;
				let version = packages?.[dir]?.version;
				version = version ? "@" + version : "";
				let rewritten = path.join(config.dir, dir + version);
				map[specifier] = url.replace(whole, rewritten);

				if (!paths[dir]) {
					paths[dir] = rewritten;
					cpSync(whole, rewritten, { recursive: true });
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
