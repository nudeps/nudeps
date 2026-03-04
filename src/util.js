export * from "./util/fs.js";
export * from "./util/path.js";

/**
 * Deep-merge `source` into `target`, recursing into nested objects.
 * Properties set to `undefined` in `source` are deleted from `target`.
 * @param {object} target
 * @param {object} source
 * @returns {object} The mutated target
 */
export function deepAssign (target, source) {
	if (!target) {
		target = {};
	}
	for (let key in source) {
		if (!target[key]) {
			target[key] = {};
		}

		if (typeof source[key] === "object" && source[key] !== null) {
			target[key] = deepAssign(target[key], source[key]);
		}
		else {
			target[key] = source[key];
		}

		if (target[key] === undefined) {
			delete target[key];
		}
	}

	return target;
}
