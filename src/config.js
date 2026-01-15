/**
 * Initialize nudeps for a given project repo
 */

import { importCwdRelative } from "./util.js";
import { existsSync } from "node:fs";
import minimist from "minimist";

export function init (cwd = process.cwd()) {}

export const availableOptions = {
	dir: {
		flag: "d",
		default: "./client_modules",
	},
	map: {
		flag: "m",
		default: "importmap.js",
	},
	exclude: {
		flag: "e",
		parse: v => v.split(","),
		default: [],
	},
	prune: {
		default: false,
	},
	config: {
		flag: "c",
		default: "nudeps.js",
		validate: v => existsSync(v),
	},
};

function readArgs (argv = process.argv.slice(2)) {
	let args = minimist(argv);
	let ret = {};

	for (let key in availableOptions) {
		let option = availableOptions[key];
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
		ret[key] = args[key] ?? config[key] ?? option.default;

		if (option.validate && !option.validate(ret[key])) {
			delete ret[key];
		}
	}

	return ret;
}
