/**
 * Parse CLI arguments into nudeps option overrides.
 * Reads process.argv by default; accepts a custom argv array for testing.
 * Only coerces values by declared type; validation happens in getConfig, which throws loudly.
 */
import minimist from "minimist";
import * as availableOptions from "../options.js";
import { coerce } from "../util/options.js";

export default function readArgs (argv = process.argv.slice(2)) {
	let args = minimist(argv);
	let ret = {};
	let known = new Set(["_"]);

	for (let key in availableOptions) {
		let option = availableOptions[key];
		known.add(key);
		if (option.flag) {
			known.add(option.flag);
		}

		if (option.cli === false) {
			continue;
		}

		if (key in args) {
			ret[key] = args[key];
		}
		else if (option.flag && option.flag in args) {
			ret[key] = args[option.flag];
		}
		else {
			continue;
		}

		if (typeof ret[key] === "string" && option.parse) {
			ret[key] = option.parse(ret[key]);
		}
		else {
			ret[key] = coerce(ret[key], option.type);
		}
	}

	for (let key in args) {
		if (!known.has(key)) {
			console.warn(`[nudeps] Ignoring unknown CLI flag --${key}`);
		}
	}

	return ret;
}
