/**
 * Initialize nudeps for a given project repo
 */

import { importCwdRelative } from "./util.js";
import { existsSync } from "node:fs";
import minimist from "minimist";
import availableOptions from "./options.js";

function readArgs (argv = process.argv.slice(2)) {
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

function readExternalConfig (args) {
	let configPath = args.config || "nudeps.js";

	if (!existsSync(configPath)) {
		if (args.config) {
			throw new Error(`${args.config} provided as config, but file does not exist`);
		}

		return null;
	}

	return importCwdRelative(configPath).then(m => m.default ?? m);
}

/**
 * Get the resolved config regardless of where settings come from
 * @returns
 */
export async function getConfig () {
	let args = readArgs();

	let config = readExternalConfig(args) ?? {};

	if (config.then) {
		config = await config;
	}

	let ret = {};
	for (let key in availableOptions) {
		let option = availableOptions[key];
		ret[key] = args[key] ?? config[key];

		if (ret[key] !== undefined) {
			if (option.validate && !option.validate(ret[key])) {
				delete ret[key];
			}
			else if (option.transform) {
				ret[key] = option.transform(ret[key]);
			}
		}

		ret[key] ??= option.default;
	}

	return ret;
}
