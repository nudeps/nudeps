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
	cjs: {
		default: true,
	},
	ignore: {
		default: [
			// Readme files with any extension
			"**/{readme,README}.*",

			// Dotfiles
			"**/.*",
			{ not: "**/.gitignore" },

			"{*,@*/*}/package.json",
			"{*,@*/*}/{package,pnpm}-lock.json",
		],
		transform (value) {
			value = Array.isArray(value) ? value : [value];
			return [...this.default, ...value];
		},
	},
};
