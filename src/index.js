/**
 * Main entry point
 */
import * as path from "node:path";
import { getConfig } from "./config.js";
import {
	readJSONSync,
	writeJSONSync,
	getTopPackage,
	getTopPackageDirectory,
	getTopLevelModules,
	isDirectoryEmptySync,
	addVersion,
	rebaseModulePath,
} from "./util.js";
import { writeFileSync, renameSync, existsSync, mkdirSync, rmSync, rmdirSync } from "node:fs";
import { cp } from "node:fs/promises";
import { getImportMap, getImportMapJs, walkMap, applyOverrides } from "./map.js";

export default async function (options) {
	let config = Object.assign(await getConfig(), options);
	let oldConfig = readJSONSync(".nudeps/config.json");

	let cacheExists = existsSync(".nudeps");
	if (cacheExists && config.init) {
		rmSync(".nudeps", { recursive: true });
		cacheExists = false;
	}

	if (!cacheExists) {
		// First run
		mkdirSync(".nudeps");
		writeFileSync(".nudeps/.gitignore", "*");
	}
	else if (oldConfig) {
		if (config.dir !== oldConfig.dir && existsSync(oldConfig.dir)) {
			if (config.init) {
				rmSync(oldConfig.dir, { recursive: true });
			}
			else {
				renameSync(oldConfig.dir, config.dir);
			}
		}
	}

	let inputMap = undefined;
	if (!config.init && !config.prune) {
		inputMap = readJSONSync(".nudeps/importmap.json");
		if (config.overrides) {
			applyOverrides(inputMap, config.overrides);
		}
		walkMap(inputMap, ({ specifier, path, map }) => {
			// Remove any paths that no longer exist
			if (!existsSync(path)) {
				delete map[specifier];
			}
		});
	}

	let map = await getImportMap({
		prune: config.prune,
		exclude: config.exclude,
		inputMap,
	});

	if (config.overrides) {
		applyOverrides(map, config.overrides);
	}

	writeJSONSync(".nudeps/importmap.json", map);
	let packages = readJSONSync("package-lock.json")?.packages;

	let dirExists = existsSync(config.dir);
	if (config.init && dirExists) {
		rmSync(config.dir, { recursive: true });
		dirExists = false;
	}

	if (!dirExists) {
		mkdirSync(config.dir, { recursive: true });
		writeFileSync(path.join(config.dir, ".gitignore"), "*");
	}

	// Extract top-level directories, copy them over to config.dir
	// using the package version at the end of the directory (e.g. @foo/bar@3.1.2 instead of @foo/bar)
	// and update the import map to use that directory instead
	let toCopy = {};

	walkMap(map, ({ specifier, path, map }) => {
		if (!getTopPackage(path)) {
			// Nothing to copy or rewrite
			return;
		}

		let dir = getTopPackageDirectory(path);
		let withVersion = addVersion(path, packages);
		let newPath = rebaseModulePath(withVersion, config.dir);
		map[specifier] = newPath;

		toCopy[dir] ??= rebaseModulePath(getTopPackageDirectory(withVersion), config.dir);
	});

	if (map.scopes) {
		for (let scope in map.scopes) {
			// Rewrite scope itself
			if (scope.includes("node_modules")) {
				let newScope = config.dir + "/" + rewritePackagePath(scope, config, packages);
				map.scopes[newScope] = map.scopes[scope];
				delete map.scopes[scope];
			}
		}
	}

	let existingDirs = new Set(getTopLevelModules(config.dir).map(d => config.dir + "/" + d));
	let toDelete = new Set(existingDirs);

	for (let from in toCopy) {
		let to = toCopy[from];
		if (existingDirs.has(to)) {
			toDelete.delete(to);
		}
		else {
			cp(from, to, { recursive: true });
		}
	}

	for (let dir of toDelete) {
		let fullPath = config.dir + "/" + dir;
		if (existsSync(fullPath)) {
			rmSync(fullPath, { recursive: true });
		}
		if (dir.includes("/")) {
			// Delete the parent directory if empty
			let parentDir = config.dir + "/" + dir.split("/")[0];
			if (existsSync(parentDir) && isDirectoryEmptySync(parentDir)) {
				rmdirSync(parentDir);
			}
		}
	}

	if (oldConfig && oldConfig.map !== config.map && existsSync(oldConfig.map)) {
		// Remove old import map
		rmSync(oldConfig.map);
	}

	let js = await getImportMapJs(map);
	writeFileSync(config.map, js);

	// intentionally async.
	// Nothing immediately hinges on the result of this, and we're not going to run update immediately after.
	if (config.prune) {
		// Save package.json at the last prune so we don't re-add packages that were pruned
		// (unless they are actually used now)
		cp("package.json", ".nudeps/package.json");
	}

	writeJSONSync(".nudeps/config.json", config);
}
