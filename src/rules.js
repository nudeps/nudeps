/**
 * Conditional config overrides: the rule matching engine and the built-in rules.
 * A rule is an object mixing matcher fields (which packages/modes it applies to)
 * with option values to override. See the `overrides` option.
 */
import { SemverRange } from "sver";
import * as availableOptions from "./options.js";
import { suggest } from "./util/options.js";

/**
 * Fields that select what a rule applies to. `package` is the internal form of the
 * dictionary shorthand: an exact string matched against name OR installName.
 */
export const MATCHERS = ["name", "installName", "version", "mode", "package"];

// Rule-only settings that are not top-level options
const RULE_ONLY = new Set(["include"]);

// Options that only make sense per package
const PACKAGE_SCOPED = new Set([
	"dir",
	"symlink",
	"preserveSymlinks",
	"alias",
	"ignore",
	"imports",
	"cjs",
]);

// Options no rule may set: they decide what runs, before rules exist
const TOP_ONLY = new Set(["mode", "config", "init", "overrides"]);

/**
 * Built-in mode presets, as rules. They sit below top-level config in the cascade,
 * so an explicit config value beats them; user rules sit above.
 */
export const builtInRules = [
	{ mode: "dev", symlink: true },
	{ mode: "prod", symlink: false, prune: true, terse: true },
];

export const builtInModes = new Set(builtInRules.flatMap(rule => [rule.mode].flat()));

/**
 * Does this rule constrain which packages it applies to?
 * Mode-only and unconditional rules apply globally.
 */
export function isPackageRule (rule) {
	return ["name", "installName", "version", "package"].some(key => rule[key] !== undefined);
}

/**
 * Match one matcher value (string | RegExp | function | array of these) against a subject value.
 * Strings are exact, except `version`, where they are semver ranges.
 */
function matchesValue (matcher, value, key) {
	if (Array.isArray(matcher)) {
		return matcher.some(m => matchesValue(m, value, key));
	}

	if (matcher instanceof RegExp) {
		return value !== undefined && matcher.test(value);
	}

	if (typeof matcher === "function") {
		return Boolean(matcher(value));
	}

	if (key === "version") {
		return value !== undefined && SemverRange.match(matcher, value);
	}

	return matcher === value;
}

/**
 * Does a rule apply to a subject ({name, installName, version, mode})?
 * All matcher fields present must match (AND); a rule with none matches everything.
 */
export function matches (rule, subject) {
	for (let key of MATCHERS) {
		let matcher = rule[key];
		if (matcher === undefined) {
			continue;
		}

		if (key === "package") {
			if (matcher !== subject.name && matcher !== subject.installName) {
				return false;
			}
		}
		else if (!matchesValue(matcher, subject[key], key)) {
			return false;
		}
	}

	return true;
}

/**
 * Apply the matching subset of rules to a base config, per property, later rules winning.
 * `ignore` is additive: rule entries append to the base list instead of replacing it,
 * matching how the built-in ignore defaults always apply.
 * @returns {object} A new object; `base` is not mutated. Matcher fields are not copied.
 */
export function applyRules (base, rules, subject) {
	let ret = { ...base };

	for (let rule of rules) {
		if (!matches(rule, subject)) {
			continue;
		}

		for (let key in rule) {
			if (MATCHERS.includes(key)) {
				continue;
			}

			if (key === "ignore") {
				ret.ignore = [...(ret.ignore ?? []), ...rule.ignore];
			}
			else {
				ret[key] = rule[key];
			}
		}
	}

	return ret;
}

/**
 * Normalize the `overrides` option into the canonical array-of-rules form:
 * dictionary entries become rules with the internal `package` matcher,
 * and nested `ignore` values get the same shape as the top-level option
 * (minus the built-in defaults, which the global list already carries).
 */
export function normalizeRules (value) {
	if (!value) {
		return [];
	}

	let rules = Array.isArray(value)
		? value
		: Object.entries(value).map(([key, rule]) => ({ package: key, ...rule }));

	return rules.map(rule => {
		if (rule.ignore !== undefined) {
			rule = {
				...rule,
				ignore: [rule.ignore].flat().map(p => (typeof p === "string" ? { ignore: p } : p)),
			};
		}

		return rule;
	});
}

/**
 * Extract the exact package names a matcher can produce, or null if it is a pattern
 * (regex/function) that cannot be enumerated.
 */
function exactNames (matcher) {
	let values = [matcher].flat();
	return values.every(v => typeof v === "string") ? values : null;
}

/**
 * Validate normalized rules; throws on structural errors.
 * @param {object[]} rules
 * @param {Set<string>} [optionKeys] - Known top-level option names
 */
export function validateRules (rules, optionKeys = new Set(Object.keys(availableOptions))) {
	for (let rule of rules) {
		if (typeof rule !== "object" || rule === null) {
			throw new Error(`Invalid overrides rule: ${JSON.stringify(rule)}. Expected an object.`);
		}

		let packageRule = isPackageRule(rule);

		for (let key in rule) {
			if (MATCHERS.includes(key)) {
				continue;
			}

			if (!optionKeys.has(key) && !RULE_ONLY.has(key)) {
				let suggestion = suggest(key, [...optionKeys, ...RULE_ONLY, ...MATCHERS]);
				let hint = suggestion ? ` Did you mean "${suggestion}"?` : "";
				throw new Error(`Unknown key "${key}" in overrides rule.${hint}`);
			}

			if (TOP_ONLY.has(key)) {
				throw new Error(`Option "${key}" cannot be set from an overrides rule.`);
			}

			if (packageRule && !PACKAGE_SCOPED.has(key) && !RULE_ONLY.has(key)) {
				throw new Error(
					`Option "${key}" is not package-scoped, so a package-matched overrides rule cannot set it.`,
				);
			}
		}

		let { include } = rule;
		if (include !== undefined) {
			if (![true, false, "force"].includes(include)) {
				throw new Error(
					`Invalid include value in overrides rule: ${JSON.stringify(include)}. Expected true, false, or "force".`,
				);
			}

			if (!packageRule) {
				throw new Error(`include requires a rule that names packages.`);
			}

			// Installing needs concrete names — patterns can only drop
			if (include !== false && includeNames(rule) === null) {
				throw new Error(
					`include: ${JSON.stringify(include)} requires exact package names to install, not patterns.`,
				);
			}
		}
	}
}

/**
 * The exact package names a rule's package matchers name, or null when they are patterns.
 * @returns {string[] | null}
 */
export function includeNames (rule) {
	let matchers = [rule.package, rule.name, rule.installName].filter(m => m !== undefined);
	let names = [];

	for (let matcher of matchers) {
		let exact = exactNames(matcher);
		if (exact === null) {
			return null;
		}
		names.push(...exact);
	}

	return names;
}
