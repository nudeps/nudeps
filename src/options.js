import * as path from "node:path";
import * as hosts from "./hosts.js";

/**
 * @import Package from "./util/package.js"
 */

/**
 * A file pattern in `ignore`. A bare string is shorthand for `{ exclude: pattern }`.
 * Later patterns win over earlier ones.
 * @typedef {object} IgnorePattern
 * @property {string} [exclude] - Glob of files to skip when copying a package.
 * @property {string} [include] - Glob of files to keep, overriding earlier `exclude` patterns.
 * @property {string | string[]} [packageName] - Only apply this pattern to these packages.
 */

/**
 * Every nudeps option, as accepted from programmatic args, the `nudeps.js` config file,
 * a mode preset, or CLI flags (in that order of precedence).
 * @typedef {object} NudepsOptions
 * @property {string} [dir="./client_modules"] - Directory to copy (or symlink) client-side dependencies into.
 * @property {string} [map="importmap.js"] - Path of the generated import map script.
 * @property {string} [publishDir] - Directory the host serves as `/`, defaults to the package (or workspace) root.
 * Only needed when `dir` lives inside a build output directory (e.g. an SSG's `dist/`), since redirect rules are URLs, not file paths.
 * @property {string} [host] - Deploy host adapter (a key of `hosts.js`, e.g. `"netlify"`). Auto-detected from the environment when not set.
 * @property {string} [mode] - Mode preset to take defaults from: built-in `"dev"` or `"prod"`, or a key of `modes`.
 * @property {Record<string, NudepsOptions>} [modes] - Custom mode presets, keyed by name.
 * Each can extend another by setting its own `mode`. Config file only.
 * @property {string} [config="nudeps.js"] - Path of the config file to read. Ignored if the file does not exist.
 * @property {boolean} [init=false] - Start from scratch: delete the `.nudeps` cache and `dir` before generating.
 * @property {string | string[]} [exclude=[]] - Dependency names to keep out of the import map entirely (e.g. server-only deps).
 * @property {string | string[]} [additionalDependencies=[]] - Extra packages to map beyond the host's `dependencies`,
 * e.g. client libraries injected by a tool calling nudeps programmatically. Treated like `dependencies`.
 * @property {string | string[]} [forceDependencies=[]] - Like `additionalDependencies`, but kept even when `prune` is on.
 * Subject to `exclude`: a name in both is excluded, with a warning.
 * @property {boolean} [prune=false] - Subset the import map to only the specifiers the entry points actually use.
 * @property {boolean} [terse=false] - Lightly minify the generated import map script.
 * @property {boolean} [module=false] - Whether the import map script will be loaded as `type="module"`.
 * @property {boolean} [cjs=true] - Add `cjs-browser-shim` when CommonJS packages are detected.
 * @property {boolean} [combineSubpaths=false] - Collapse a package's subpath mappings into a single trailing-slash mapping where possible.
 * @property {boolean | ((pkg: Package) => boolean)} [symlink] - Whether to symlink a package instead of copying it.
 * Defaults to symlinking only external packages (those outside the local `node_modules` tree).
 * @property {boolean | string[] | ((pkg: {packageName: string, version: string}) => boolean)} [preserveSymlinks=false] - Whether to keep symlinks inside a copied package as-is instead of resolving them to real paths.
 * @property {boolean | string | string[] | Record<string, any> | ((pkg: Package) => string | string[])} [alias=true] - Unversioned symlinks pointing at the versioned directories, so assets (CSS, images) have stable URLs.
 * `true` aliases every package, a string or array aliases those names, an object maps package names to aliases, a function computes them.
 * @property {object} [overrides] - Partial import map (`imports`, `scopes`) deep-merged into the generated one.
 * @property {Array<string | IgnorePattern>} [ignore] - Files to skip when copying packages.
 * Adds to the defaults (readmes, dotfiles, package and lockfiles) rather than replacing them.
 * @property {Record<string, Function | Function[]>} [hooks] - Lifecycle hook callbacks, see [blissful-hooks](https://github.com/LeaVerou/blissful-hooks).
 * @property {NudepsOptions} [defaults] - Fallbacks for anything the config file and mode preset leave unset,
 * so a tool running nudeps programmatically can suggest values without overriding the user's own config. Programmatic API only.
 */

export const dir = {
	flag: "d",
	type: "string",
	default: "./client_modules",
	normalize: (v, defaultValue) => path.normalize(v ?? defaultValue),
};

export const mode = {
	flag: "m",
	type: "string",
};

export const map = {
	flag: "o",
	type: "string",
	default: "importmap.js",
};

export const terse = {
	type: "boolean",
	default: false,
};

export const exclude = {
	flag: "e",
	type: ["string", "list"],
	parse: v => v.split(","),
	default: [],
	normalize: (v, defaultValue) => (v == null ? defaultValue : [v].flat()),
};

// Extra packages to add to the import map beyond the host's `dependencies` — e.g. a tool
// (static site generator, etc.) calling nudeps programmatically can inject its own client
// libraries. Treated exactly like `dependencies` (installed unless pruned, subject to
// `exclude`); a no-op for anything already in `dependencies`.
export const additionalDependencies = {
	cli: false,
	type: ["string", "list"],
	default: [],
	normalize: (v, defaultValue) => (v == null ? defaultValue : [v].flat()),
};

// Packages to keep in the import map even when `prune` is true. Like `additionalDependencies`,
// but not subject to pruning — use for packages you always want available regardless of whether
// the entry points reference them. Subject to `exclude` (a name in both is excluded, with a warning).
export const forceDependencies = {
	cli: false,
	type: ["string", "list"],
	default: [],
	normalize: (v, defaultValue) => (v == null ? defaultValue : [v].flat()),
};

export const prune = {
	type: "boolean",
	default: false,
};

// A missing explicitly-passed path throws in readExternalConfig; a path from
// `defaults` is only a suggestion, so no existence validation here.
export const config = {
	flag: "c",
	type: "string",
	default: "nudeps.js",
};

export const init = {
	type: "boolean",
	default: false,
};

export const overrides = {
	cli: false,
	type: "object",
};

export const hooks = {
	cli: false,
	type: "object",
};

// The directory the host serves as `/`. Only needed when `dir` lives inside a build output
// directory (e.g. an SSG's `dist/`), since redirect rules are URLs, not file paths.
export const publishDir = {
	flag: "publish-dir",
	type: "string",
};

export const module = {
	type: "boolean",
	default: false,
};

export const cjs = {
	type: "boolean",
	default: true,
};

export const combineSubpaths = {
	flag: "combine-subpaths",
	type: ["boolean", "string"],
	default: false,
	validate: v => typeof v === "boolean" || v === "both",
};

export const ignore = {
	type: ["string", "object", "list"],
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
	type: ["boolean", "function"],
	default: pkg => pkg.isExternal,
};

export const preserveSymlinks = {
	type: ["boolean", "list", "function"],
	default: false,
};

export const alias = {
	type: ["boolean", "string", "list", "object", "function"],
	default: true,
};

// Deploy host adapter; auto-detected from the environment when not set.
export const host = {
	type: "string",
	validate: v => v in hosts,
};
