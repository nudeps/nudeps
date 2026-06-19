/**
 * Main entry point
 */
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getConfig } from "./config.js";
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { writeJSONSync, createGitignoredDir } from "./util.js";
import Nudeps from "./nudeps.js";

export default async function (options) {
	// A workspace child's install-time hooks (e.g. `prepare`) run before npm writes the lockfile —
	// skip that too-early run; the post-install re-run (lockfile now present) regenerates.
	let root = process.env.npm_config_local_prefix;
	if (
		root &&
		root !== process.cwd() &&
		!existsSync(path.join(root, "node_modules", ".package-lock.json"))
	) {
		console.info(
			"[nudeps] Skipping import map generation during workspace install — it runs once the lockfile is written. If this is not a workspace, please run Nudeps from the package root.",
		);
		return;
	}

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

	// Surface promoted clientDependencies as regular deps so the trace below picks them up.
	// Skipped in prune mode — that path doesn't pre-install pkg.dependencies either.
	if (!config.prune && nudeps.packages.clientDependencies?.size) {
		nudeps.pkg.dependencies ??= {};
		for (let name of nudeps.packages.clientDependencies) {
			nudeps.pkg.dependencies[name] ??= "*";
		}
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

	// Rewrite the import map to point at local copies, then materialize those copies in config.dir
	nudeps.localizeMap();

	// Seed aliased deps the map walk missed (CSS-only packages — #102)
	if (config.alias) {
		let exclude = new Set(config.exclude ?? []);
		for (let dep in nudeps.pkg.dependencies) {
			if (exclude.has(dep)) {
				continue;
			}

			let pkg = nudeps.packages.get(dep);

			if (pkg && !pkg.parent && nudeps.aliases(pkg).length > 0) {
				nudeps.toCopy[pkg.path] ??= nudeps.localDir(pkg);
			}
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
	const { map, stats } = nudeps;
	let mapContent = map.toJS({ module: config.module, terse: config.terse });
	let existingMap = existsSync(config.map) ? readFileSync(config.map, "utf8") : null;
	let mapChanged = mapContent !== existingMap;

	if (mapChanged) {
		mkdirSync(path.dirname(config.map), { recursive: true });
		writeFileSync(config.map, mapContent);
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

	// Register as a dependent of our local deps so they can notify us of their changes (always),
	// then notify our own dependents if our output changed. The mapChanged gate breaks
	// propagation cycles between mutually-local deps (map converges → no change → stops).
	nudeps.registerAsDependent();
	if (mapChanged) {
		nudeps.notifyDependents();
	}
}
