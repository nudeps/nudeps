/**
 * Helpers for the option registry: type checking and CLI coercion,
 * typo suggestions, and config serialization for cache comparison.
 */

/**
 * Check a value against an option's declared type(s).
 * @param {any} value
 * @param {string | string[]} [type] - "boolean" | "string" | "number" | "list" | "object" | "function", or an array of these
 * @returns {boolean}
 */
export function checkType (value, type) {
	if (!type) {
		return true;
	}

	return [type].flat().some(t => {
		if (t === "list") {
			return Array.isArray(value);
		}

		if (t === "object") {
			return typeof value === "object" && value !== null && !Array.isArray(value);
		}

		return typeof value === t;
	});
}

/**
 * Coerce a CLI string into an option's type where unambiguous:
 * "true"/"false" for boolean-accepting options. Anything else passes
 * through for the option's own `parse` or validation to handle.
 * @param {any} value
 * @param {string | string[]} [type]
 */
export function coerce (value, type) {
	if (typeof value !== "string" || !type) {
		return value;
	}

	if ([type].flat().includes("boolean") && (value === "true" || value === "false")) {
		return value === "true";
	}

	return value;
}

/**
 * Suggest the closest known name for a typo, or undefined if nothing is close.
 * @param {string} name
 * @param {string[]} candidates
 */
export function suggest (name, candidates) {
	let best;
	let bestDistance = Math.max(2, Math.floor(name.length / 3));

	for (let candidate of candidates) {
		let distance = levenshtein(name.toLowerCase(), candidate.toLowerCase());
		if (distance <= bestDistance) {
			best = candidate;
			bestDistance = distance;
		}
	}

	return best;
}

function levenshtein (a, b) {
	let row = Array.from({ length: b.length + 1 }, (_, i) => i);

	for (let i = 1; i <= a.length; i++) {
		let prev = row[0]++;

		for (let j = 1; j <= b.length; j++) {
			let current = row[j];
			row[j] = Math.min(current + 1, row[j - 1] + 1, prev + (a[i - 1] !== b[j - 1]));
			prev = current;
		}
	}

	return row[b.length];
}

/**
 * Serialize a config object so that function and regex values survive as their source text.
 * Idempotent across a write/read/write cycle, so it can be used both to persist
 * `.nudeps/config.json` and to compare against it for cache invalidation.
 * @param {object} config
 * @returns {string}
 */
export function stringifyConfig (config) {
	return JSON.stringify(
		config,
		(key, value) => {
			if (typeof value === "function" || value instanceof RegExp) {
				return String(value);
			}

			return value;
		},
		"\t",
	);
}
