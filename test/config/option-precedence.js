import { getConfig } from "../../src/config.js";

// Path is cwd-relative, like any user-supplied `config` value; tests run from the package root
const CONFIG_FILE = "test/config/defaults-fixture.js";

export default {
	name: "getConfig precedence",
	async run (overrides) {
		let { publishDir, mode, terse } = await getConfig(overrides);
		return { publishDir, mode, terse };
	},
	tests: [
		{
			name: "defaults apply when nothing else sets the option",
			arg: { defaults: { publishDir: "_site" } },
			expect: { publishDir: "_site", mode: undefined, terse: false },
		},
		{
			name: "programmatic options beat defaults",
			arg: { publishDir: "explicit", defaults: { publishDir: "_site" } },
			expect: { publishDir: "explicit", mode: undefined, terse: false },
		},
		{
			name: "config file beats defaults",
			arg: { config: CONFIG_FILE, defaults: { publishDir: "_site" } },
			expect: { publishDir: "from-config", mode: undefined, terse: false },
		},
		{
			name: "programmatic options still beat the config file",
			arg: { config: CONFIG_FILE, publishDir: "explicit" },
			expect: { publishDir: "explicit", mode: undefined, terse: false },
		},
		{
			// Mode is resolved from the same chain, so a defaulted mode still brings its own defaults
			name: "a defaulted mode resolves that mode's option defaults",
			arg: { defaults: { mode: "prod" } },
			expect: { publishDir: undefined, mode: "prod", terse: true },
		},
	],
};
