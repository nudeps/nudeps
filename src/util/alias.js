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

	let overrides = {};
	for (let [name, spec] of Object.entries(pkg.dependencies)) {
		if (typeof spec === "string" && spec.startsWith("npm:")) {
			overrides[name] = `./node_modules/${name}`;
		}
	}

	if (Object.keys(overrides).length === 0) {
		return;
	}

	// We need the full package URL to key packageConfigs, so build an explicit baseUrl.
	let baseUrl = pathToFileURL(path.resolve(".") + "/");
	let pkgOverride = {
		...pkg,
		dependencies: {
			...(pkg.dependencies ?? {}),
			...overrides,
		},
	};

	return {
		// baseUrl,
		packageConfigs: {
			[baseUrl.href]: pkgOverride,
		},
	};
}
