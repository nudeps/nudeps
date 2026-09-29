/**
 * Main entry point
 */
import * as path from "node:path";
import { existsSync } from "node:fs";
import { readJSONSync } from "./util.js";
import Nudeps from "./nudeps.js";
import Packages from "./util/packages.js";
import * as log from "./util/log.js";

export { Nudeps };

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
			log.warn(
				`The workspace root has no \`dependencies\` hook, so its children's import maps go stale on every install. Run \`npx nudeps install\` here to add it to ${path.join(root, "package.json")}.`,
			);
		}

		// No lockfile yet means nothing to resolve against either way — and it is the only signal
		// left when a hook wraps nudeps in `npx`, whose own npm run replaces `npm_command`.
		if (
			REIFY_COMMANDS.includes(process.env.npm_command) ||
			!existsSync(path.join(root, "node_modules", ".package-lock.json"))
		) {
			log.info(
				"Skipping import map generation: npm hasn't finished updating the lockfile this package resolves against. If this is not a workspace, please run Nudeps from the package root.",
			);
			return null;
		}
	}

	let nudeps = new Nudeps(options);
	await nudeps.write();

	return nudeps;
}
