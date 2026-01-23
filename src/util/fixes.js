import * as path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Handle known issues with dependencies in package.json
 * @param {object} pkg Parsed package.json
 * @returns {object} Generator options to merge into the generator options
 */
export function fixDependencies (pkg) {
	if (!pkg?.dependencies) {
		return;
	}

	let deps = pkg.dependencies;
	let fixedAliases = fixAliases(deps) ?? {};
	let fixedGitHubPackages = fixGitHubPackages(deps) ?? {};

	// We need the full package URL to key packageConfigs, so build an explicit baseUrl.
	let baseUrl = pathToFileURL(path.resolve(".") + "/");

	return {
		packageConfigs: {
			[baseUrl.href]: {
				dependencies: {
					...fixedAliases,
					...fixedGitHubPackages,
				},
			},
		},
	};
}

/**
 * Handle npm aliases in package.json dependencies
 * Workaround for https://github.com/jspm/jspm/issues/2687
 * @param {object} deps Mapping of dependencies from package.json
 * @returns {object} Mapping of fixed dependencies
 */
function fixAliases (deps = {}) {
	let aliases = Object.entries(deps).flatMap(([name, spec]) =>
		spec?.startsWith("npm:") ? name : []);

	if (aliases.length === 0) {
		return;
	}

	return Object.fromEntries(aliases.map(name => [name, `./node_modules/${name}`]));
}

/**
 * Handle GitHub URLs in package.json dependencies
 * Workaround for https://github.com/jspm/jspm/issues/2688
 * @param {object} deps Mapping of dependencies from package.json
 * @returns {object} Mapping of fixed dependencies
 */
function fixGitHubPackages (deps = {}) {
	let urls = Object.entries(deps).filter(([name, spec]) => spec?.startsWith("github:"));

	if (urls.length === 0) {
		return;
	}

	return Object.fromEntries(urls.map(([name, spec]) => [name, spec.replace(/^github:/, "")]));
}
