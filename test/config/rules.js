import {
	matches,
	applyRules,
	normalizeRules,
	validateRules,
	isPackageRule,
	includeNames,
} from "../../src/rules.js";

const PKG = { name: "leaflet", installName: "leaflet", version: "1.9.4", mode: "prod" };

export default {
	name: "Override rule engine",
	tests: [
		{
			name: "matches()",
			run: matches,
			tests: [
				{ name: "exact name", args: [{ name: "leaflet" }, PKG], expect: true },
				{ name: "wrong name", args: [{ name: "vue" }, PKG], expect: false },
				{
					name: "regex installName",
					args: [{ installName: /^leaf/ }, PKG],
					expect: true,
				},
				{
					name: "predicate on the field value",
					args: [{ name: n => n.length > 3 }, PKG],
					expect: true,
				},
				{
					name: "any-of array",
					args: [{ name: ["vue", "leaflet"] }, PKG],
					expect: true,
				},
				{
					name: "semver range version",
					args: [{ name: "leaflet", version: "^1" }, PKG],
					expect: true,
				},
				{
					name: "semver range excludes other majors",
					args: [{ name: "leaflet", version: "^2" }, PKG],
					expect: false,
				},
				{
					name: "multiple fields AND",
					args: [{ name: "leaflet", mode: "dev" }, PKG],
					expect: false,
				},
				{ name: "no matchers = unconditional", args: [{ terse: true }, PKG], expect: true },
				{
					name: "dictionary key matches installName too",
					args: [{ package: "jquery1" }, { name: "jquery", installName: "jquery1" }],
					expect: true,
				},
			],
		},
		{
			name: "applyRules()",
			check: { deep: true },
			tests: [
				{
					name: "later rule wins per property, non-matching skipped",
					run: () =>
						applyRules(
							{ symlink: false, terse: false },
							[
								{ name: "leaflet", symlink: true },
								{ name: "vue", terse: true },
								{ name: "leaflet", version: "^1", symlink: false },
							],
							PKG,
						),
					expect: { symlink: false, terse: false },
				},
				{
					name: "ignore appends instead of replacing",
					run: () =>
						applyRules(
							{ ignore: [{ ignore: "*.map" }] },
							[{ name: "leaflet", ignore: [{ ignore: "docs/**" }] }],
							PKG,
						).ignore,
					expect: [{ ignore: "*.map" }, { ignore: "docs/**" }],
				},
			],
		},
		{
			name: "normalizeRules()",
			check: { deep: true },
			tests: [
				{
					name: "dictionary desugars to package rules",
					run: () => normalizeRules({ "open-props": { alias: "../open-props" } }),
					expect: [{ package: "open-props", alias: "../open-props" }],
				},
				{
					name: "nested ignore strings get the canonical shape",
					run: () => normalizeRules([{ name: "leaflet", ignore: "docs/**" }]),
					expect: [{ name: "leaflet", ignore: [{ ignore: "docs/**" }] }],
				},
			],
		},
		{
			name: "validateRules()",
			run: rules => validateRules(normalizeRules(rules)),
			tests: [
				{
					name: "package rule cannot set a global option",
					arg: [{ name: "leaflet", terse: true }],
					throws: e => e.message.includes("not package-scoped"),
				},
				{
					name: "mode in a rule is a matcher, not a setting (package × mode is legal)",
					arg: [{ name: "leaflet", mode: "prod", symlink: false }],
					expect: undefined,
				},
				{
					name: "rules cannot set top-only options",
					arg: [{ init: true }],
					throws: e => e.message.includes(`"init"`),
				},
				{
					name: "unknown rule key throws with suggestion",
					arg: [{ name: "leaflet", alais: true }],
					throws: e => e.message.includes("alais") && e.message.includes("alias"),
				},
				{
					name: "include with a pattern matcher cannot install",
					arg: [{ name: /^@types\//, include: true }],
					throws: e => e.message.includes("exact package names"),
				},
				{
					name: "include: false accepts patterns",
					arg: [{ name: /^@types\//, include: false }],
					expect: undefined,
				},
				{
					name: "include requires naming packages",
					arg: [{ mode: "prod", include: false }],
					throws: e => e.message.includes("names packages"),
				},
			],
		},
		{
			name: "helpers",
			tests: [
				{
					name: "isPackageRule: mode-only is global",
					run: () => isPackageRule({ mode: "prod", terse: true }),
					expect: false,
				},
				{
					name: "isPackageRule: version counts",
					run: () => isPackageRule({ version: "^1", symlink: false }),
					expect: true,
				},
				{
					name: "includeNames returns exact names",
					run: () => includeNames({ name: ["chai", "sinon"], include: true }),
					check: { deep: true },
					expect: ["chai", "sinon"],
				},
				{
					name: "includeNames is null for patterns",
					run: () => includeNames({ name: /^@types\//, include: false }),
					expect: null,
				},
			],
		},
	],
};
