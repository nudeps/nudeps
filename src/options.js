import * as path from "node:path";
import * as hosts from "./hosts.js";

/**
 * @import Package from "./util/package.js"
 */

/**
 * A file pattern in `ignore`. A bare string is shorthand for `{ ignore: pattern }`.
 * Later patterns win over earlier ones.
 * @typedef {object} IgnorePattern
 * @property {string} [ignore] - Glob of files to skip when copying a package.
 * @property {string} [copy] - Glob of files to keep, overriding earlier `ignore` patterns.
 */

/**
 * A matcher for one field of an override rule: an exact string (a semver range for `version`),
 * a regex, a predicate on the field's value, or an array of these (any-of).
 * @typedef {string | RegExp | ((value: string) => boolean) | Array<string | RegExp | ((value: string) => boolean)>} Matcher
 */

/**
 * A conditional config override: matcher fields (`name`, `installName`, `version`, `mode`)
 * select which packages and/or modes the rule applies to (all present must match;
 * none = unconditional), and the remaining keys are option values to override.
 * Package-matched rules may set only package-scoped options (`dir`, `symlink`,
 * `preserveSymlinks`, `alias`, `ignore`, `imports`, `cjs`) plus `include`;
 * mode-only and unconditional rules may set any option.
 * @typedef {object} OverrideRule
 * @property {Matcher} [name] - Package name to match.
 * @property {Matcher} [installName] - Install name (the key in `dependencies`) to match.
 * @property {Matcher} [version] - Package version to match (string = semver range).
 * @property {Matcher} [mode] - Active mode to match.
 * @property {boolean | "force"} [include] - Membership in the direct-install set:
 * `true` installs the package like a dependency even if unlisted (prunable),
 * `"force"` also survives `prune`, `false` removes it from direct installs
 * (it still gets mapped if something imports it). `undefined` = standard behavior.
 */

/**
 * Every nudeps option, as accepted from programmatic args, the `nudeps.js` config file,
 * override rules, or CLI flags.
 * @typedef {object} NudepsOptions
 * @property {string} [dir="./client_modules"] - Directory to copy (or symlink) client-side dependencies into.
 * @property {string} [map="importmap.js"] - Path of the generated import map script.
 * @property {string} [root] - Directory the host serves as `/`, defaults to the package (or workspace) root.
 * Only needed when `dir` lives inside a build output directory (e.g. an SSG's `dist/`), since redirect rules are URLs, not file paths.
 * @property {string} [host] - Deploy host adapter (a key of `hosts.js`, e.g. `"netlify"`). Auto-detected from the environment when not set.
 * @property {string} [mode] - Active mode, tested by rules with `mode` matchers. Built-in presets: `"dev"` and `"prod"`.
 * @property {string} [config="nudeps.js"] - Path of the config file to read. Ignored if the file does not exist.
 * @property {boolean} [init=false] - Start from scratch: delete the `.nudeps` cache and `dir` before generating.
 * @property {boolean} [prune=false] - Subset the import map to only the specifiers the entry points actually use
 * (plus `include: "force"` packages).
 * @property {boolean} [terse=false] - Lightly minify the generated import map script.
 * @property {boolean} [module=false] - Whether the import map script will be loaded as `type="module"`.
 * @property {boolean} [cjs=true] - Add `cjs-browser-shim` when CommonJS packages are detected.
 * @property {"split" | "combined" | "both"} [subpaths="split"] - Whether to collapse a package's subpath mappings
 * into a single trailing-slash mapping: `"split"` keeps every used subpath explicit, `"combined"` collapses
 * within scopes, `"both"` also collapses top-level.
 * @property {boolean | ((pkg: Package) => boolean)} [symlink] - Whether to symlink a package instead of copying it.
 * Defaults to symlinking only external packages (those outside the local `node_modules` tree).
 * @property {boolean} [preserveSymlinks=false] - Whether to keep symlinks inside a copied package as-is instead of resolving them to real paths.
 * @property {boolean | string} [alias=true] - Unversioned symlink pointing at a package's versioned directory,
 * so assets (CSS, images) have stable URLs. `true` uses the install name; a string is a custom path relative to
 * the package's effective `dir` (and may escape it, e.g. `"../open-props"`).
 * @property {Record<string, string | undefined>} [imports] - Import map entries deep-merged into the generated
 * map's `imports`; values are paths relative to the map or full URLs, and `undefined` deletes an entry.
 * Inside a package-matched rule, values are paths relative to that package instead.
 * @property {Array<string | IgnorePattern>} [ignore] - Files to skip when copying packages; globs are
 * package-relative. Adds to the defaults (readmes, dotfiles, package and lockfiles) rather than replacing them —
 * a later `{ copy }` pattern reverses an earlier ignore, including the defaults.
 * @property {Record<string, Omit<OverrideRule, "name" | "installName">> | OverrideRule[]} [overrides] - Conditional
 * config overrides. The dictionary form keys are single exact names (matched against name or install name);
 * the array form gives full rules. All matching rules apply in order, later wins, merged per property.
 * @property {Record<string, Function | Function[]>} [hooks] - Lifecycle hook callbacks, see [blissful-hooks](https://github.com/LeaVerou/blissful-hooks).
 * @property {NudepsOptions} [defaults] - Fallbacks for anything the config file and rules leave unset,
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

// Conditional overrides: per package, per mode, or unconditional.
// Normalization and validation live in rules.js, orchestrated by getConfig.
export const overrides = {
	cli: false,
	type: ["object", "list"],
};

// Import map entries merged into the generated map (specifier → path/URL).
export const imports = {
	cli: false,
	type: "object",
};

export const hooks = {
	cli: false,
	type: "object",
};

// The directory the host serves as `/`. Only needed when `dir` lives inside a build output
// directory (e.g. an SSG's `dist/`), since redirect rules are URLs, not file paths.
export const root = {
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

export const subpaths = {
	type: "string",
	default: "split",
	validate: v => ["split", "combined", "both"].includes(v),
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

		return value.map(p => (typeof p === "string" ? { ignore: p } : p));
	},
};

export const symlink = {
	type: ["boolean", "function"],
	default: pkg => pkg.isExternal,
};

export const preserveSymlinks = {
	type: "boolean",
	default: false,
};

export const alias = {
	type: ["boolean", "string"],
	default: true,
};

// Deploy host adapter; auto-detected from the environment when not set.
export const host = {
	type: "string",
	validate: v => v in hosts,
};
