/**
 * Initialize nudeps for a given project repo
 */

import { importCwdRelative } from "./util.js";
import { existsSync } from "node:fs";
import * as availableOptions from "./options.js";
import { checkType, suggest } from "./util/options.js";
import {
	builtInRules,
	builtInModes,
	normalizeRules,
	validateRules,
	isPackageRule,
	applyRules,
} from "./rules.js";

/**
 * @import { NudepsOptions } from "./options.js"
 */

// Keys from previous versions, mapped to what replaced them
const RENAMED = {
	exclude: `overrides rules with include: false, e.g. overrides: [{ name: "foo", include: false }]`,
	additionalDependencies: `overrides rules with include: true`,
	forceDependencies: `overrides rules with include: "force"`,
	combineSubpaths: `subpaths: "split" | "combined" | "both"`,
	publishDir: `root`,
	modes: `overrides rules with mode matchers, e.g. overrides: [{ mode: "staging", terse: false }]`,
};

function readExternalConfig (args, defaults = {}) {
	// A path from `defaults` is only a suggestion, so a missing file falls back to no config
	let configPath = args.config || defaults.config || "nudeps.js";

	if (!existsSync(configPath)) {
		if (args.config) {
			throw new Error(`${args.config} provided as config, but file does not exist`);
		}

		return null;
	}

	return importCwdRelative(configPath).then(m => m.default ?? m);
}

/**
 * Get the resolved config regardless of where settings come from.
 * Precedence (weakest to strongest): option defaults < `defaults` < built-in rules <
 * top-level config file values < matching user rules < programmatic/CLI args.
 * Package-matched rules are not folded here; Nudeps resolves them per package.
 * @param {NudepsOptions} [overrides] - Options taking precedence over the config file and rules,
 * except `defaults`, which is only consulted when nothing else supplies a value.
 * @returns {NudepsOptions} Every option, normalized, with defaults applied.
 */
export async function getConfig ({ defaults = {}, ...args } = {}) {
	let config = readExternalConfig(args, defaults) ?? {};

	if (config.then) {
		config = await config;
	}

	// Unknown keys are almost always typos (or pre-rename options) — fail loudly,
	// for programmatic callers and the config file alike
	for (let [keys, from] of [
		[Object.keys(config), "config file"],
		[Object.keys(args), "options"],
		[Object.keys(defaults), "defaults"],
	]) {
		for (let key of keys) {
			if (key in RENAMED) {
				throw new Error(
					`The "${key}" option (from ${from}) was replaced by ${RENAMED[key]}.`,
				);
			}

			if (!(key in availableOptions)) {
				let suggestion = suggest(key, Object.keys(availableOptions));
				let hint = suggestion ? ` Did you mean "${suggestion}"?` : "";
				throw new Error(`Unknown option "${key}" (from ${from}).${hint}`);
			}
		}
	}

	let mode = args.mode ?? config.mode ?? defaults.mode;

	// Overrides resolve first: global (mode-only/unconditional) rules feed the other options.
	// Layers concatenate rather than replace — rules are a cascade, and a tool passing rules
	// programmatically must not clobber the config file's own — ordered weakest-origin first.
	for (let rawRules of [defaults.overrides, config.overrides, args.overrides]) {
		if (rawRules && looksLikeImportMap(rawRules)) {
			throw new Error(
				`The "overrides" option now holds conditional config rules; import map patches moved to "imports".`,
			);
		}
	}

	let rules = [defaults.overrides, config.overrides, args.overrides].flatMap(normalizeRules);
	validateRules(rules);
	warnOnUnknownMode(mode, rules);

	let subject = { mode };
	let globalRules = rules.filter(rule => !isPackageRule(rule));
	let fromBuiltIns = applyRules({}, builtInRules, subject);
	let fromRules = applyRules({}, globalRules, subject);

	let ret = {};
	for (let key in availableOptions) {
		let option = availableOptions[key];

		if (key === "overrides") {
			// Already normalized; kept whole (incl. package rules) for Nudeps and the cache key
			ret.overrides = rules;
			continue;
		}

		// Track where the value came from so validation errors can point at the culprit
		let sources = [
			[args[key], "options"],
			[fromRules[key], "overrides"],
			[config[key], "config file"],
			[fromBuiltIns[key], `mode "${mode}"`],
			[defaults[key], "defaults"],
		];
		let [value, source] = sources.find(([v]) => v !== undefined) ?? [];

		if (value !== undefined) {
			let typeOk = checkType(value, option.type);
			if (!typeOk || (option.validate && !option.validate(value))) {
				let expected = typeOk ? "" : ` Expected ${[option.type].flat().join(" or ")}.`;
				throw new Error(
					`Invalid value for option "${key}" (from ${source}): ${JSON.stringify(value) ?? value}.${expected}`,
				);
			}
		}

		if (option.normalize) {
			value = option.normalize(value, option.default);
		}
		else {
			value ??= option.default;
		}

		ret[key] = value;
	}

	return ret;
}

/**
 * The old map-merge overrides shape ({imports, scopes}) now belongs to `imports` —
 * catch it so migrating configs get a pointed error rather than rule validation noise.
 */
function looksLikeImportMap (value) {
	return (
		typeof value === "object" &&
		!Array.isArray(value) &&
		("imports" in value || "scopes" in value) &&
		Object.values(value).every(v => typeof v === "object")
	);
}

/**
 * Modes are no longer declared anywhere, so the best we can do for a typo'd active mode
 * is check that some rule (or built-in) could match it. Patterns can't be enumerated —
 * any regex/function mode matcher disables the check.
 */
function warnOnUnknownMode (mode, rules) {
	if (mode === undefined || builtInModes.has(mode)) {
		return;
	}

	let known = new Set();
	for (let rule of rules) {
		if (rule.mode === undefined) {
			continue;
		}

		for (let matcher of [rule.mode].flat()) {
			if (typeof matcher !== "string") {
				return; // Pattern — can't tell, stay quiet
			}
			known.add(matcher);
		}
	}

	if (!known.has(mode)) {
		let available = [...builtInModes, ...known].join(", ");
		console.warn(`Unknown mode "${mode}". Modes referenced by rules: ${available}`);
	}
}
