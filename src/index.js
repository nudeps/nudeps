/**
 * Main entry point
 */
import Nudeps from "./nudeps.js";

export { Nudeps };

/**
 * @import { NudepsOptions } from "./options.js"
 */

/**
 * Generate the import map and materialize client-side dependencies.
 * @param {NudepsOptions} [options] - Overrides taking precedence over the config file and mode defaults.
 * @returns {Promise<Nudeps | null>} The Nudeps instance, whose `config` holds the resolved options.
 * `null` when the run was skipped because `isDeferred()` returned true.
 */
export default async function (options) {
	let nudeps = new Nudeps(options);

	if (nudeps.isDeferred()) {
		return null;
	}

	await nudeps.write();

	return nudeps;
}
