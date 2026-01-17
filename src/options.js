import { existsSync } from "node:fs";

export default {
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
	prune: {},
	config: {
		flag: "c",
		default: "nudeps.js",
		validate: v => existsSync(v),
		file: false,
	},
	init: {},
	overrides: {
		cli: false,
	},
};
