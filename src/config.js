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
		default: "client_modules",
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
	config: {
		flag: "c",
		default: "nudeps.js",
	},
};

function readArgs () {
	let args = minimist(process.argv.slice(2));
	let ret = {};

	for (let key in availableOptions) {
		let option = availableOptions[key];
		if (key in args) {
			ret[key] = args[key];
		}
		else if (option.flag in args) {
			ret[key] = args[option.flag];
		}

		if (typeof ret[key] === "string" && option.parse) {
			ret[key] = option.parse(ret[key]);
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
	}

	return ret;
}
