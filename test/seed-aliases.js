import Nudeps from "../src/nudeps.js";
import Packages from "../src/util/packages.js";

// Lockfile fixture. bootstrap-icons and no-alias-pkg are CSS/asset-only here in spirit:
// at the Packages level there are no entry points to encode, which is exactly why they
// produce zero import-map entries and thus never land in toCopy via the map walk.
// dev-only is top-level in node_modules but NOT a declared production dependency
// (simulates a devDependency or hoisted transitive package). nested is a child package.
let packages = new Packages({
	packages: {
		"node_modules/bootstrap-icons": { name: "bootstrap-icons", version: "1.13.1" },
		"node_modules/no-alias-pkg": { name: "no-alias-pkg", version: "1.0.0" },
		"node_modules/dev-only": { name: "dev-only", version: "1.0.0" },
		"node_modules/bootstrap-icons/node_modules/nested": { name: "nested", version: "1.0.0" },
	},
});

let defaultDependencies = { "bootstrap-icons": "^1.13.1", "no-alias-pkg": "^1.0.0" };

/**
 * Build a Nudeps instance without touching the real filesystem. `init: true` skips the
 * getTopLevelModules() scan in the constructor; the lazy `packages`/`pkg` getters are
 * overridden with fixtures so neither node_modules nor package.json is read.
 */
function makeNudeps ({ alias, exclude = [], dependencies = defaultDependencies }) {
	let nudeps = new Nudeps({
		config: { init: true, ignore: [], alias, exclude, dir: "client_modules" },
	});
	Object.defineProperty(nudeps, "packages", { value: packages, configurable: true });
	Object.defineProperty(nudeps, "pkg", { value: { dependencies }, configurable: true });
	return nudeps;
}

let seedTests = {
	name: "seedAliasedPackages",
	run (scenario) {
		let { preToCopy = {}, ...config } = scenario;
		let nudeps = makeNudeps(config);
		let toCopy = { ...preToCopy };
		nudeps.seedAliasedPackages(toCopy);
		return toCopy;
	},
	tests: [
		{
			name: "object alias seeds a CSS-only package the map walk never reached",
			arg: { alias: { "bootstrap-icons": "../bootstrap-icons" } },
			expect: { "./node_modules/bootstrap-icons": "client_modules/bootstrap-icons@1.13.1" },
		},
		{
			name: "alias: true seeds all top-level production deps",
			arg: { alias: true },
			expect: {
				"./node_modules/bootstrap-icons": "client_modules/bootstrap-icons@1.13.1",
				"./node_modules/no-alias-pkg": "client_modules/no-alias-pkg@1.0.0",
			},
		},
		{
			name: "alias: false seeds nothing",
			arg: { alias: false },
			expect: {},
		},
		{
			name: "devDependencies / hoisted transitive top-level packages are not seeded",
			// dev-only is top-level but absent from dependencies, so it must be skipped.
			arg: { alias: true, dependencies: { "bootstrap-icons": "^1.13.1" } },
			expect: { "./node_modules/bootstrap-icons": "client_modules/bootstrap-icons@1.13.1" },
		},
		{
			name: "exclude is honored",
			arg: { alias: true, exclude: ["bootstrap-icons"] },
			expect: { "./node_modules/no-alias-pkg": "client_modules/no-alias-pkg@1.0.0" },
		},
		{
			name: "nested (child) packages are not seeded",
			// `nested` lives under bootstrap-icons and isn't a top-level dep.
			arg: { alias: { nested: "../nested" }, dependencies: { nested: "*" } },
			expect: {},
		},
		{
			name: "entries already materialized by the map walk are not overwritten",
			arg: {
				alias: true,
				preToCopy: {
					"./node_modules/bootstrap-icons": "client_modules/bootstrap-icons@OLD",
				},
			},
			expect: {
				"./node_modules/bootstrap-icons": "client_modules/bootstrap-icons@OLD",
				"./node_modules/no-alias-pkg": "client_modules/no-alias-pkg@1.0.0",
			},
		},
	],
};

let unmatchedTests = {
	name: "unmatchedAliases",
	run (alias) {
		return makeNudeps({ alias }).unmatchedAliases();
	},
	tests: [
		{
			name: "object alias key with no matching package is reported",
			arg: { "bootstrap-icons": "../bootstrap-icons", "bootstrap-icon": "../typo" },
			expect: ["bootstrap-icon"],
		},
		{
			name: "object alias with all keys matching reports nothing",
			arg: { "bootstrap-icons": "../bootstrap-icons" },
			expect: [],
		},
		{
			name: "alias: true is not object form, reports nothing",
			arg: true,
			expect: [],
		},
		{
			name: "string alias is not object form, reports nothing",
			arg: "bootstrap-icons",
			expect: [],
		},
	],
};

export default {
	name: "alias seeding (issue #102)",
	tests: [seedTests, unmatchedTests],
};
