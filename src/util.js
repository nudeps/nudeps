export * from "./util/fs.js";
export * from "./util/path.js";
import { builtinModules } from "node:module";

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

export function deepMerge (...objects) {
	return objects.reduce((acc, obj) => deepAssign(acc, obj));
}

let nodeBuiltins = null;
export function getNodeBuiltins () {
	nodeBuiltins ??= Array.from(
		new Set(
			builtinModules.flatMap(mod =>
				mod.startsWith("node:") ? [mod, mod.slice(5)] : [mod, `node:${mod}`]),
		),
	);
	return nodeBuiltins;
}
