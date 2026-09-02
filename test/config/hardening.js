import { getConfig } from "../../src/config.js";
import readArgs from "../../src/cli/args.js";
import { stringifyConfig, suggest } from "../../src/util/options.js";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// getConfig() reads the config file off disk, so these are written out rather than passed in
let dir = mkdtempSync(join(tmpdir(), "nudeps-hardening-"));
function configFile (name, source) {
	let file = join(dir, name);
	writeFileSync(file, source);
	return file;
}

const TYPO = configFile("typo.js", `export default { trese: true };`);
const BAD_TYPE = configFile("bad-type.js", `export default { publishDir: 42 };`);
const BAD_ENUM = configFile("bad-enum.js", `export default { combineSubpaths: "nope" };`);
const STRING_EXCLUDE = configFile("string-exclude.js", `export default { exclude: "foo" };`);
const HOST = configFile("host.js", `export default { host: "netlify" };`);
const BAD_HOST = configFile("bad-host.js", `export default { host: "geocities" };`);

export default {
	name: "Config pipeline hardening",
	afterAll () {
		rmSync(dir, { recursive: true, force: true });
	},
	tests: [
		{
			name: "Loud failures",
			run: getConfig,
			tests: [
				{
					name: "unknown config key throws with a suggestion",
					arg: { config: TYPO },
					throws: e => e.message.includes("trese") && e.message.includes("terse"),
				},
				{
					name: "invalid type throws and names the source",
					arg: { config: BAD_TYPE },
					throws: e =>
						e.message.includes("publishDir") && e.message.includes("config file"),
				},
				{
					name: "failing validate throws",
					arg: { config: BAD_ENUM },
					throws: e => e.message.includes("combineSubpaths"),
				},
				{
					name: "invalid programmatic value throws and names the source",
					arg: { config: HOST, terse: "yes" },
					throws: e => e.message.includes("terse") && e.message.includes("options"),
				},
				{
					name: "explicitly passed missing config file throws",
					arg: { config: join(dir, "does-not-exist.js") },
					throws: e => e.message.includes("does not exist"),
				},
				{
					name: "unknown host throws",
					arg: { config: BAD_HOST },
					throws: e => e.message.includes("host"),
				},
			],
		},
		{
			name: "Normalization and registration",
			run: getConfig,
			check: { subset: true, deep: true },
			tests: [
				{
					name: "a string exclude becomes a one-element array",
					arg: { config: STRING_EXCLUDE },
					expect: { exclude: ["foo"] },
				},
				{
					name: "host is a real option",
					arg: { config: HOST },
					expect: { host: "netlify" },
				},
			],
		},
		{
			name: "CLI coercion",
			run: readArgs,
			check: { deep: true },
			tests: [
				{
					name: "--symlink=false coerces to a boolean",
					arg: ["--symlink=false"],
					expect: { symlink: false },
				},
				{
					name: "-e a,b splits into a list",
					arg: ["-e", "a,b"],
					expect: { exclude: ["a", "b"] },
				},
				{
					name: "--alias=header stays a string",
					arg: ["--alias=header"],
					expect: { alias: "header" },
				},
				{
					name: "an invalid value is passed through for getConfig to reject",
					arg: ["--terse=yes"],
					expect: { terse: "yes" },
				},
			],
		},
		{
			name: "Config serialization for cache comparison",
			tests: [
				{
					name: "different functions produce different serializations",
					run: () =>
						stringifyConfig({ symlink: pkg => pkg.isExternal }) ===
						stringifyConfig({ symlink: () => true }),
					expect: false,
				},
				{
					name: "survives a write/parse/write round trip unchanged",
					run () {
						let config = { symlink: pkg => pkg.isExternal, exclude: ["foo"] };
						let once = stringifyConfig(config);
						return stringifyConfig(JSON.parse(once)) === once;
					},
					expect: true,
				},
			],
		},
		{
			name: "suggest()",
			run: suggest,
			tests: [
				{
					name: "close typo",
					args: ["trese", ["terse", "prune", "dir"]],
					expect: "terse",
				},
				{
					name: "nothing close",
					args: ["zebra", ["terse", "prune", "dir"]],
					expect: undefined,
				},
			],
		},
	],
};
