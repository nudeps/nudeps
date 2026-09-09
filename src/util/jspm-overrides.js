/**
 * Applies JSPM community overrides to package configs.
 * These fix broken/incomplete package.json metadata (exports, main, etc.)
 * that the jspm.io CDN normally applies server-side.
 *
 * @see https://github.com/jspm/overrides
 */

/** The raw overrides data, keyed by package name then version key. */
import overrides from "@jspm/overrides" with { type: "json" };
export { overrides };

const EXPORT_CONDITIONS_BLACKLIST = ["types", "typings"];

/**
 * Strip non-runtime export conditions before JSPM sees them.
 * A subpath exported *only* under one of these has no runtime resolution,
 * so JSPM enumerates it but then refuses to resolve it, failing the install.
 * @see https://github.com/jspm/jspm/issues/2751
 * @param {import("@jspm/generator").ExportsTarget} exports
 * @returns {import("@jspm/generator").ExportsTarget}
 */
export function stripConditions (exports) {
	if (!exports || typeof exports !== "object") {
		return exports;
	}

	if (Array.isArray(exports)) {
		// Fallback array: strip each alternative
		return exports.map(stripConditions);
	}

	let ret = {};
	for (let key in exports) {
		if (EXPORT_CONDITIONS_BLACKLIST.includes(key)) {
			continue;
		}

		ret[key] = stripConditions(exports[key]);
	}

	return ret;
}

/**
 * Find the best matching override for a given package name and version.
 * Override keys like "3" or "16.8.0" mean "same major, >= this version".
 * Among multiple matches, the most specific (most segments) wins.
 * @param {string} name - Package name (e.g. "vue")
 * @param {string} version - Installed version (e.g. "3.5.26")
 * @returns {object|null} The override object to merge, or null
 */
export function findOverride (name, version) {
	let pkgOverrides = overrides[name];
	if (!pkgOverrides) {
		return null;
	}

	let installed = parseVersion(version);
	if (!installed) {
		return null;
	}

	// Find all matching keys, pick the most specific (most segments)
	let bestKey = Object.keys(pkgOverrides)
		.map(key => ({ key, segments: parseVersion(key) }))
		.filter(
			({ segments: s }) => s && s[0] === installed[0] && s.every((v, i) => installed[i] >= v),
		)
		.sort((a, b) => b.segments.length - a.segments.length)[0]?.key;

	return bestKey ? pkgOverrides[bestKey] : null;
}

/**
 * Parse a version string into an array of numeric segments.
 * @param {string} version - e.g. "3", "3.5", "3.5.26"
 * @returns {number[] | null}
 */
function parseVersion (version) {
	if (!version) {
		return null;
	}

	let parts = version.split(".").map(s => parseInt(s));

	let end = parts.findIndex(isNaN);
	if (end !== -1) {
		parts = parts.slice(0, end);
	}

	return parts.length ? parts : null;
}
