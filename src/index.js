/**
 * Main entry point
 */
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getConfig } from "./config.js";
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { readJSONSync, writeJSONSync, createGitignoredDir } from "./util.js";
import { execSync } from "node:child_process";
import Nudeps from "./nudeps.js";

export default async function (options) {
	let config = await getConfig(options);
	let nudeps = new Nudeps({ config });
	let oldConfig = nudeps.oldConfig;

	let cacheExists = existsSync(".nudeps");
	if (cacheExists && config.init) {
		// Note: this also clears local-dependents.json. Dependents will
		// re-register themselves the next time they run nudeps.
		rmSync(".nudeps", { recursive: true });
		cacheExists = false;
	}

	if (!cacheExists) {
		createGitignoredDir(".nudeps");
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

	const generator = nudeps.generator;
	let resolveStart = performance.now();
	try {
		await generator.install(nudeps.pkg.name, ".");
	}
	catch (e) {
		nudeps.error(`Failed to install root package. ${e.message}`);
		// Store the error for potential manual mapping later
		var rootInstallError = e;
	}

	if (!config.prune && nudeps.pkg.dependencies) {
		let exclude = new Set(config.exclude ?? []);

		for (const dep in nudeps.pkg.dependencies) {
			if (exclude.has(dep)) {
				continue;
			}

			try {
				await generator.install(dep);
			}
			catch (e) {
				nudeps.error(`Error installing ${dep}: ${e.message}`);
			}
		}
	}
	nudeps.stats.resolveTime = performance.now() - resolveStart;

	// If root package installation failed due to missing dependencies in the entry point,
	// add it manually after all dependencies are installed using JSPM's resolver.
	// We do this AFTER dependency installation because generator.install() regenerates the
	// import map, which would overwrite any mappings added earlier.
	// See https://github.com/nudeps/nudeps/issues/30
	// Note: string prefix match on JSPM error message — may need updating if JSPM changes it.
	if (rootInstallError?.message.startsWith("Cannot find package")) {
		try {
			let entryPoint = await generator.traceMap.resolver.resolveExport(
				pathToFileURL(process.cwd() + "/").href,
				".",
				false,
				false,
				nudeps.pkg.name,
			);
			entryPoint = path.relative(process.cwd(), fileURLToPath(entryPoint));
			entryPoint = entryPoint.startsWith(".") ? entryPoint : `./${entryPoint}`;
			generator.map.set(nudeps.pkg.name, entryPoint);
		}
		catch (e) {
			nudeps.error(`Failed to manually resolve root package entry point. ${e.message}`);
		}
	}

	await nudeps.finalize();

	let dirExists = existsSync(config.dir);
	if (config.init && dirExists) {
		rmSync(config.dir, { recursive: true });
		dirExists = false;
	}

	if (!dirExists) {
		createGitignoredDir(config.dir);
	}

	// Extract top-level directories, copy them over to config.dir
	// using the package version at the end of the directory (e.g. @foo/bar@3.1.2 instead of @foo/bar)
	// and update the import map to use that directory instead

	let { toCopy } = nudeps;

	const { map, stats, packages } = nudeps;

	for (let { specifier, url, map: subMap } of map) {
		stats.entries++;

		if (!url.includes("node_modules/")) {
			// Nothing to copy or rewrite
			continue;
		}

		let { pkg, filePath, sourcePath } = packages.parse(url);

		let localPath = pkg ? nudeps.localPath(pkg, filePath) : config.dir + "/" + filePath;
		let urlFromMap = path.relative(path.dirname(config.map), localPath); // Note: path.relative() might normalize away the trailing slash for directories
		urlFromMap = urlFromMap.startsWith(".") ? urlFromMap : "./" + urlFromMap;
		if (specifier.endsWith("/") && !urlFromMap.endsWith("/")) {
			// Preserve directory specifiers that require a trailing slash in import maps
			urlFromMap += "/";
		}
		subMap[specifier] = urlFromMap;
		if (pkg) {
			toCopy[sourcePath] ??= nudeps.localDir(pkg);
		}
	}

	if (map.scopes) {
		for (let scope in map.scopes) {
			if (!scope.includes("node_modules/")) {
				continue;
			}

			// Rewrite scope itself
			let { pkg: scopePkg } = packages.parse(scope);
			let scopeLocalDir = scopePkg ? nudeps.localDir(scopePkg) : config.dir;
			let scopeFromMap = path.relative(path.dirname(config.map), scopeLocalDir);
			scopeFromMap = scopeFromMap.startsWith(".") ? scopeFromMap : "./" + scopeFromMap;
			map.scopes[scopeFromMap] = map.scopes[scope];
			delete map.scopes[scope];
		}
	}

	await nudeps.copyPackages();

	// Write import map
	if (oldConfig && oldConfig.map !== config.map && existsSync(oldConfig.map)) {
		// Remove old import map
		rmSync(oldConfig.map);
	}

	// Detect whether the map actually changed (used to skip propagation on no-ops,
	// which also naturally breaks cycles between mutually-local deps).
	let mapContent = map.toJS({ module: config.module, terse: config.terse });
	let existingMap = existsSync(config.map) ? readFileSync(config.map, "utf8") : null;
	let mapChanged = mapContent !== existingMap;

	if (mapChanged) {
		mkdirSync(path.dirname(config.map), { recursive: true });
		writeFileSync(config.map, mapContent);
	}

	// Persist external alias paths so they can be cleaned up on next run
	if (nudeps.externalAliases?.size > 0) {
		writeJSONSync(".nudeps/external-aliases.json", [...nudeps.externalAliases]);
	}
	else if (existsSync(".nudeps/external-aliases.json")) {
		rmSync(".nudeps/external-aliases.json");
	}

	writeJSONSync(".nudeps/config.json", config);

	let info = [];
	if (stats.copied + stats.deleted + stats.aliased > 0) {
		let parts = ["copied", "deleted", "aliased"]
			.filter(p => stats[p] > 0)
			.map(p => `${stats[p]} ${p}`);

		let msg =
			parts.length > 2
				? parts.slice(0, -1).join(", ") + ", and " + parts.at(-1)
				: parts.join(" and ");
		info.push(msg + ` in ${config.dir}.`);
	}
	let { cacheHits, cacheMisses } = generator.stats;
	let cacheInfo = cacheHits > 0 ? `, ${cacheHits}/${cacheHits + cacheMisses} cached` : "";
	if (mapChanged) {
		info.push(
			`Import map with ${stats.entries} entries generated successfully at ${config.map}. Time taken: ${+nudeps.elapsedTime.toFixed(2)} ms (resolve: ${+stats.resolveTime.toFixed(2)} ms${cacheInfo}).`,
		);
	}
	else {
		info.push(
			`Import map unchanged (${stats.entries} entries). Time taken: ${+nudeps.elapsedTime.toFixed(2)} ms (resolve: ${+stats.resolveTime.toFixed(2)} ms${cacheInfo}).`,
		);
	}
	nudeps.info(...info);

	// Register this repo as a dependent of each local dep, so they can propagate changes back.
	// Only process production dependencies — devDependencies are not installed by nudeps.
	let prodDeps = new Set(Object.keys(nudeps.pkg.dependencies ?? {}));
	for (let pkg of packages.externals) {
		if (!prodDeps.has(pkg.installName)) {
			continue;
		}
		if (!existsSync(pkg.resolvedPath)) {
			continue;
		}

		if (!pkg.hasDependency("nudeps")) {
			// Nudeps not installed on the local dep — propagation requires nudeps on both ends.
			nudeps.info(
				`Local dependency at ${pkg.resolvedPath} doesn't have nudeps installed. ` +
					`Install nudeps there to enable change propagation.`,
			);
			continue;
		}

		// Ensure .nudeps/ exists in the dep, then add ourselves to its dependents list
		let depNudepsDir = path.join(pkg.resolvedPath, ".nudeps");
		createGitignoredDir(depNudepsDir);

		let dependentsFile = path.join(depNudepsDir, "local-dependents.json");
		let dependents = readJSONSync(dependentsFile, { optional: true }) ?? [];
		let relPath = path.relative(pkg.resolvedPath, ".");

		if (!dependents.includes(relPath)) {
			dependents.push(relPath);
			writeJSONSync(dependentsFile, dependents);
		}
	}

	// Propagate: if our map changed, trigger the dependencies hook in repos that depend on
	// this one locally. --if-present silently skips if no hook is configured.
	// Content-based comparison naturally breaks cycles (map converges → no change → stops).
	if (mapChanged) {
		let dependents = readJSONSync(".nudeps/local-dependents.json", { optional: true });

		for (let entry of dependents ?? []) {
			nudeps.info(`Propagating to dependent: ${entry}`);

			try {
				execSync("npm run dependencies --if-present", { cwd: entry, stdio: "inherit" });
			}
			catch (e) {
				nudeps.error(`Failed to propagate to ${entry}: ${e.message}`);
			}
		}
	}
}
