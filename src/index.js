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
import { ImportMapGenerator, ImportMap } from "./map.js";
import ModulePath from "./util/paths.js";

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

	const pkg = readJSONSync("./package.json");

	if (!pkg) {
		throw new Error("package.json not found or invalid");
	}

	let generator = new ImportMapGenerator({ commonJS: config.cjs });

	// Ensure the generator has completed tracing before we inspect its trace cache.
	try {
		await generator.install(pkg.name, ".");
	}
	catch (e) {}

	if (!config.prune && pkg.dependencies) {
		let exclude = new Set(config.exclude ?? []);
		let lastPruneDeps = readJSONSync(".nudeps/package.json")?.dependencies ?? {};

		for (const dep in pkg.dependencies) {
			if (exclude.has(dep) || lastPruneDeps[dep]) {
				continue;
			}

			try {
				await generator.install(dep);
			}
			catch (error) {
				console.error(`Error installing ${dep}: ${error.message}`);
			}
		}
	}

	let cjsEntries = [];
	if (config.cjs !== false) {
		cjsEntries = generator.getEntries(entry => entry?.format === "commonjs");

		if (cjsEntries.length > 0) {
			try {
				await generator.install("cjs-browser-shim");
			}
			catch (e) {
				await generator.install(
					"cjs-browser-shim",
					"./node_modules/nudeps/node_modules/cjs-browser-shim",
				);
			}

			let cjsPackages = [
				...new Set(cjsEntries.map(([url]) => ModulePath.from(url).packageName)),
			];
			let directCjsDeps = cjsPackages.filter(packageName => packageName in pkg.dependencies);
			let requireMsg = "";
			if (directCjsDeps.length > 0) {
				requireMsg = `Use require() to import these packages: ${directCjsDeps.join(", ")}.`;
			}
			console.info(
				`[nudeps] ${cjsPackages.length} CommonJS packages detected, adding cjs-browser-shim. ${requireMsg} Disable with --cjs=false`,
			);
		}
	}

	let map = new ImportMap(generator);

	map.cleanupScopes();

	if (config.overrides) {
		map.applyOverrides(config.overrides);
	}

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

	ModulePath.localDir = config.dir;
	ModulePath.packages = packages;

	const stats = { entries: 0, copied: 0, deleted: 0 };

	for (let { specifier, url, map: subMap } of map) {
		if (!url.includes("node_modules/")) {
			// Nothing to copy or rewrite
			continue;
		}

		let modulePath = ModulePath.from(url);

		let urlFromMap = path.relative(path.dirname(config.map), modulePath.localPath); // Note: path.relative() might normalize away the trailing slash for directories
		urlFromMap = urlFromMap.startsWith(".") ? urlFromMap : "./" + urlFromMap;
		if (specifier.endsWith("/") && !urlFromMap.endsWith("/")) {
			// Preserve directory specifiers that require a trailing slash in import maps
			urlFromMap += "/";
		}
		subMap[specifier] = urlFromMap;
		stats.entries++;
		toCopy[modulePath.nodeDir] ??= modulePath.localDir;

		if (modulePath.isNested) {
			// Delete nested node_modules directory
			let parentPath = [modulePath.parent.localDir, "node_modules", modulePath.packageName];
			toDelete.add(parentPath.join("/"));
		}
	}

	if (map.scopes) {
		for (let scope in map.scopes) {
			if (!scope.includes("node_modules/")) {
				continue;
			}

			// Rewrite scope itself
			let scopeFromMap = path.relative(
				path.dirname(config.map),
				ModulePath.from(scope).localDir,
			);
			scopeFromMap = scopeFromMap.startsWith(".") ? scopeFromMap : "./" + scopeFromMap;
			let localDir = scopeFromMap;
			map.scopes[localDir] = map.scopes[scope];
			delete map.scopes[scope];
		}
	}

	for (let from in toCopy) {
		let to = toCopy[from];
		if (existingDirs.has(to)) {
			toDelete.delete(to);
		}
		else {
			stats.copied++;
			cpSync(from, to, { recursive: true });
		}
	}

	for (let dir of toDelete) {
		if (existsSync(dir)) {
			stats.deleted++;
			rmSync(dir, { recursive: true });
		}

		let parentDir = dir.split("/").slice(0, -1).join("/");

		if (parentDir === config.dir) {
			continue;
		}

		// Delete the parent directory if empty
		if (existsSync(parentDir) && isDirectoryEmptySync(parentDir)) {
			stats.deleted++;
			rmdirSync(parentDir);
		}
	}

	if (oldConfig && oldConfig.map !== config.map && existsSync(oldConfig.map)) {
		// Remove old import map
		rmSync(oldConfig.map);
	}

	mkdirSync(path.dirname(config.map), { recursive: true });
	writeFileSync(config.map, map.js);

	// intentionally async.
	// Nothing immediately hinges on the result of this, and we're not going to run update immediately after.
	if (config.prune) {
		// Save package.json at the last prune so we don't re-add packages that were pruned
		// (unless they are actually used now)
		cp("package.json", ".nudeps/package.json");
	}

	writeJSONSync(".nudeps/config.json", config);

	let info = [];
	if (stats.copied + stats.deleted > 0) {
		info.push(
			`${stats.copied} directories added, and ${stats.deleted} deleted from ${config.dir}.`,
		);
	}
	info.push(`Import map with ${stats.entries} entries generated successfully at ${config.map}.`);
	console.log(`[nudeps] ${info.join(" ")}`);
}
