/**
 * Main entry point
 */
import * as path from "node:path";
import { getConfig } from "./config.js";
import { readJSONSync, writeJSONSync, getTopLevelModules, isDirectoryEmptySync } from "./util.js";
import {
	writeFileSync,
	renameSync,
	existsSync,
	mkdirSync,
	rmSync,
	rmdirSync,
	cpSync,
} from "node:fs";
import { cp } from "node:fs/promises";
import { ImportMap, getImportMapJs, walkMap, applyOverrides } from "./map.js";

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

	const pkg = readJSONSync("./package.json");

	if (!pkg) {
		throw new Error("package.json not found or invalid");
	}

	let map = new ImportMap({ inputMap });
	map.install(pkg.name, "./");
	// console.log(".", map.getMap());

	if (!config.prune && pkg.dependencies) {
		let exclude = new Set(config.exclude ?? []);
		let lastPruneDeps = readJSONSync(".nudeps/package.json")?.dependencies ?? {};

		for (const dep in pkg.dependencies) {
			if (exclude.has(dep) || lastPruneDeps[dep]) {
				continue;
			}

			await map.install(dep);

			// console.log(dep, map.getMap());
		}
	}

	map = map.getMap();

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
	let existingDirs = new Set(getTopLevelModules(config.dir).map(d => config.dir + "/" + d));
	let toDelete = new Set(existingDirs);

	walkMap(map, ({ specifier, path, map }) => {
		let parts = path.split("/");
		let index = parts.indexOf("node_modules");

		if (index === -1) {
			// Nothing to copy or rewrite
			return;
		}

		let indexLast = parts.lastIndexOf("node_modules");
		let isNested = index !== indexLast;
		let dirIndex = indexLast + (parts[indexLast + 1].startsWith("@") ? 2 : 1);
		let lockKey = parts.slice(index, dirIndex + 1).join("/");

		let version = packages[lockKey]?.version;
		let packageName = parts.slice(indexLast + 1, dirIndex + 1).join("/");

		let dir = parts.slice(0, dirIndex + 1).join("/");
		let targetDir = [config.dir, packageName + "@" + version].join("/");
		let newPath = [targetDir, ...parts.slice(dirIndex + 1)].join("/");

		map[specifier] = newPath;
		toCopy[dir] ??= targetDir;

		if (isNested) {
			// Delete nested node_modules directory
			let parentDirIndex = index + (parts[index + 1].startsWith("@") ? 2 : 1);
			let parentDir = parts.slice(0, parentDirIndex + 1).join("/");
			let copiedDir = toCopy[parentDir];
			let parentPath =
				copiedDir + "/" + parts.slice(parentDirIndex + 1, indexLast + 1).join("/");
			toDelete.add(parentPath);
		}
	});

	if (map.scopes) {
		for (let scope in map.scopes) {
			// Rewrite scope itself
			let parts = scope.split("/");
			let index = parts.indexOf("node_modules");

			if (index === -1) {
				continue;
			}

			let indexLast = parts.lastIndexOf("node_modules");
			let dirIndex = indexLast + (parts[indexLast + 1].startsWith("@") ? 2 : 1);
			let lockKey = parts.slice(index, dirIndex + 1).join("/");
			let version = packages[lockKey]?.version;
			let packageName = parts.slice(indexLast + 1, dirIndex + 1).join("/");
			let newScope = [config.dir, packageName + "@" + version].join("/");

			map.scopes[newScope] = map.scopes[scope];
			delete map.scopes[scope];
		}
	}

	for (let from in toCopy) {
		let to = toCopy[from];
		if (existingDirs.has(to)) {
			toDelete.delete(to);
		}
		else {
			cpSync(from, to, { recursive: true });
		}
	}

	for (let dir of toDelete) {
		if (existsSync(dir)) {
			rmSync(dir, { recursive: true });
		}

		let parentDir = dir.split("/").slice(0, -1).join("/");

		if (parentDir === config.dir) {
			continue;
		}

		// Delete the parent directory if empty
		if (existsSync(parentDir) && isDirectoryEmptySync(parentDir)) {
			rmdirSync(parentDir);
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
