/**
 * Parse CLI arguments into nudeps option overrides.
 * Reads process.argv by default; accepts a custom argv array for testing.
 */
import minimist from "minimist";
import availableOptions from "../options.js";

export default function readArgs (argv = process.argv.slice(2)) {
	let args = minimist(argv);
	let ret = {};

	for (let key in availableOptions) {
		let option = availableOptions[key];
		if (option.cli === false) {
			continue;
		}

		if (key in args) {
			ret[key] = args[key];
		}
		else if (option.flag in args) {
			ret[key] = args[option.flag];
		}
		else {
			continue;
		}

		if (typeof ret[key] === "string" && option.parse) {
			ret[key] = option.parse(ret[key]);
		}
		else if (
			typeof option.default === "boolean" &&
			(ret[key] === "true" || ret[key] === "false")
		) {
			ret[key] = ret[key] === "true";
		}

		if (option.validate && !option.validate(ret[key])) {
			delete ret[key];
		}
	}

	return ret;
}
