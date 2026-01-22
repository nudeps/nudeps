/**
 * Main entry point
 */
import * as path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Handle npm aliases in package.json dependencies
 * Workaround for https://github.com/jspm/jspm/issues/2687
 * @param {object} pkg Parsed package.json
 * @returns {object} Generator options to merge into the generator options
 */
export function fixAliases (pkg) {
	if (!pkg?.dependencies) {
		return;
	}

	let aliases = Object.entries(pkg.dependencies).flatMap(([name, spec]) =>
		spec?.startsWith("npm:") ? name : []);

	if (aliases.length === 0) {
		return;
	}

	// We need the full package URL to key packageConfigs, so build an explicit baseUrl.
	let baseUrl = pathToFileURL(path.resolve(".") + "/");

	return {
		packageConfigs: {
			[baseUrl.href]: {
				dependencies: Object.fromEntries(
					aliases.map(([name]) => [name, `./node_modules/${name}`]),
				),
			},
		},
	};
}
