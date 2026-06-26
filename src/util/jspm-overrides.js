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
 * Strip export conditions that would shadow `default` in JSPM's wildcard
 * resolution (jspm/jspm#2717). At each object level:
 * - If any sibling is known (in `conditions` or is `default`), drop the unknown
 *   siblings — JSPM has a resolution to pick, the rest get in the way.
 * - Otherwise leave the object alone; we can't tell which condition would resolve.
 *
 * `types`/`typings` are always stripped: they resolve to `.d.ts` files which
 * break JSPM tracing even when they're the only condition.
 * @param {import("@jspm/generator").ExportsTarget} exports
 * @param {string[]} conditions - Recognized export conditions (JSPM resolver env)
 * @returns {import("@jspm/generator").ExportsTarget}
 */
export function stripConditions (exports, conditions) {
	if (!exports || typeof exports !== "object") {
		return exports;
	}

	if (Array.isArray(exports)) {
		// Fallback array: strip each alternative
		return exports.map(item => stripConditions(item, conditions));
	}

	let hasKnown = Object.keys(exports).some(key => key === "default" || conditions.includes(key));

	let ret = {};
	for (let key in exports) {
		if (
			EXPORT_CONDITIONS_BLACKLIST.includes(key) ||
			(hasKnown && key !== "default" && !conditions.includes(key))
		) {
			continue;
		}

		ret[key] = stripConditions(exports[key], conditions);
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
