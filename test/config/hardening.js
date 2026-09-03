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
const BAD_TYPE = configFile("bad-type.js", `export default { root: 42 };`);
const BAD_ENUM = configFile("bad-enum.js", `export default { subpaths: "nope" };`);
const RENAMED = configFile("renamed.js", `export default { exclude: ["foo"] };`);
const OLD_OVERRIDES = configFile(
	"old-overrides.js",
	`export default { overrides: { imports: { foo: "./node_modules/foo/foo.js" } } };`,
);
const HOST = configFile("host.js", `export default { host: "netlify" };`);
const BAD_HOST = configFile("bad-host.js", `export default { host: "geocities" };`);
const RULES = configFile(
	"rules.js",
	`export default { overrides: [{ mode: "loud", terse: true }] };`,
);

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
					throws: e => e.message.includes("root") && e.message.includes("config file"),
				},
				{
					name: "failing validate throws",
					arg: { config: BAD_ENUM },
					throws: e => e.message.includes("subpaths"),
				},
				{
					name: "renamed keys point at the replacement",
					arg: { config: RENAMED },
					throws: e =>
						e.message.includes("exclude") && e.message.includes("include: false"),
				},
				{
					name: "old import-map-shaped overrides point at imports",
					arg: { config: OLD_OVERRIDES },
					throws: e => e.message.includes(`"imports"`),
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
					name: "host is a real option",
					arg: { config: HOST },
					expect: { host: "netlify" },
				},
				{
					name: "overrides concatenate across layers instead of replacing",
					arg: {
						config: RULES,
						mode: "loud",
						overrides: [{ mode: "loud", prune: true }],
					},
					expect: { terse: true, prune: true },
				},
			],
		},
		{
			name: "Programmatic misuse",
			run: getConfig,
			tests: [
				{
					name: "renamed options error for programmatic callers too",
					arg: { config: HOST, additionalDependencies: ["x"] },
					throws: e => e.message.includes("include: true"),
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
						let config = { symlink: pkg => pkg.isExternal, ignore: ["foo"] };
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
