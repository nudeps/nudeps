import { existsSync } from "node:fs";
import * as path from "node:path";

export const dir = {
	flag: "d",
	default: "./client_modules",
	normalize: (v, defaultValue) => path.normalize(v ?? defaultValue),
};

export const mode = {
	flag: "m",
	cli: true,
};

export const map = {
	flag: "o",
	default: "importmap.js",
};

export const terse = {
	default: false,
};

export const exclude = {
	flag: "e",
	parse: v => v.split(","),
	default: [],
};

export const prune = {
	default: false,
};

export const config = {
	flag: "c",
	default: "nudeps.js",
	validate: v => existsSync(v),
	file: false,
};

export const init = {
	default: false,
};

export const overrides = {
	cli: false,
};

export const hooks = {
	cli: false,
};

export const module = {
	default: false,
};

export const cjs = {
	default: true,
};

export const combineSubpaths = {
	flag: "combine-subpaths",
	default: false,
};

export const ignore = {
	default: [
		// Readme files with any extension
		"{readme,README}.*",

		// Dotfiles
		".*",

		// Package files
		"package.json",
		"{package,pnpm}-lock.json",
	],
	normalize: (value, defaultValue) => {
		if (value) {
			value = Array.isArray(value) ? value : [value];
			value.unshift(...defaultValue);
		}
		else {
			value = defaultValue;
		}

		value = value.map(p => {
			p = typeof p === "string" ? { exclude: p } : p;

			if (p.packageName && !Array.isArray(p.packageName)) {
				p.packageName = [p.packageName];
			}

			return p;
		});

		return value;
	},
};

export const symlink = {
	default: pkg => pkg.isExternal,
};

export const preserveSymlinks = {
	default: false,
};

export const alias = {
	default: true,
};
