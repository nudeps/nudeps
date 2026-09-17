/**
 * Main entry point
 */
import * as path from "node:path";
import { getConfig } from "./config.js";
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { createGitignoredDir, readJSONSync } from "./util.js";
import { stringifyConfig } from "./util/options.js";
import Nudeps from "./nudeps.js";
import Packages from "./util/packages.js";

/**
 * @import { NudepsOptions } from "./options.js"
 */

// Commands that rewrite the lockfile after a child's hooks and then fire the root's `dependencies`
// hook, which runs nudeps again against the new one (#171). `update`, `dedupe` and `prune` fire no hook
// afterwards, so their too-early run is the only one there is — skipping those would strand the map.
const REIFY_COMMANDS = ["install", "ci", "uninstall", "link"];

/**
 * Generate the import map and materialize client-side dependencies.
 * @param {NudepsOptions} [options] - Overrides taking precedence over the config file and mode defaults.
 * @returns {Promise<Nudeps | null>} The Nudeps instance, whose `config` holds the resolved options.
 * `null` when the run was skipped: this package resolves against a parent's lockfile that npm
 * has yet to write or is about to rewrite, so the run that reads it comes later.
 */
export default async function (options) {
	let root = process.env.npm_config_local_prefix;
	// npm also runs a local dependency's hooks with its consumer as the prefix, but that package has
	// its own, current lockfile — only one resolving against the parent's has to wait for npm.
	if (root && root !== process.cwd() && Packages.findRoot() !== process.cwd()) {
		// npm fires `dependencies` on the root only, so without that hook nothing ever regenerates
		// this package's map (#172).
		let rootPkg = readJSONSync(path.join(root, "package.json"), { optional: true });
		let delegates = "npm run dependencies --if-present --workspaces";
		let variants = ["dependencies", "predependencies", "postdependencies"];

		if (
			rootPkg?.workspaces &&
			!variants.some(name => rootPkg.scripts?.[name]?.includes(delegates))
		) {
			console.warn(
				`[nudeps] The workspace root has no \`dependencies\` hook, so its children's import maps go stale on every install. Run \`npx nudeps install\` here to add it to ${path.join(root, "package.json")}.`,
			);
		}

		// No lockfile yet means nothing to resolve against either way — and it is the only signal
		// left when a hook wraps nudeps in `npx`, whose own npm run replaces `npm_command`.
		if (
			REIFY_COMMANDS.includes(process.env.npm_command) ||
			!existsSync(path.join(root, "node_modules", ".package-lock.json"))
		) {
			console.info(
				"[nudeps] Skipping import map generation: npm hasn't finished updating the lockfile this package resolves against. If this is not a workspace, please run Nudeps from the package root.",
			);
			return null;
		}
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
				// renameSync needs the destination's parent, and a consumer that clears
				// its output directory before building has just deleted it (#152)
				mkdirSync(path.dirname(config.dir), { recursive: true });
				renameSync(oldConfig.dir, config.dir);
			}
		}
	}

	await nudeps.installAll();

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

	// Seed aliased deps the map walk missed (CSS-only packages — #102).
	// aliases() consults per-package rules, so no global gate here.
	for (let dep of nudeps.directDependencies) {
		let pkg = nudeps.packages.get(dep);

		if (pkg && !pkg.parent && nudeps.aliases(pkg).length > 0) {
			nudeps.toCopy[pkg.path] ??= nudeps.localDir(pkg);
		}
	}

	await nudeps.copyPackages();

	// Write import map
	if (oldConfig && oldConfig.map !== config.map && existsSync(oldConfig.map)) {
		// Remove old import map
		rmSync(oldConfig.map);
	}

	// Detect whether the map actually changed (used to skip propagation on no-ops).
	const { map, stats } = nudeps;
	let mapContent = map.toJS({ module: config.module, terse: config.terse });
	let existingMap = existsSync(config.map) ? readFileSync(config.map, "utf8") : null;
	let mapChanged = mapContent !== existingMap;

	if (mapChanged) {
		mkdirSync(path.dirname(config.map), { recursive: true });
		writeFileSync(config.map, mapContent);
	}

	// stringifyConfig keeps function values as source text so the cache compare sees them
	writeFileSync(".nudeps/config.json", stringifyConfig(config) + "\n");

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
	let { cacheHits, cacheMisses } = nudeps.generator.stats;
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

	nudeps.registerAsDependent();
	nudeps.notifyDependents(mapChanged);

	return nudeps;
}
