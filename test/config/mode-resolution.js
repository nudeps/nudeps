import { getConfig } from "../../src/config.js";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// getConfig() reads the config file off disk, so these are written out rather than passed in
let dir = mkdtempSync(join(tmpdir(), "nudeps-modes-"));
function configFile (name, source) {
	let file = join(dir, name);
	writeFileSync(file, source);
	return file;
}

const EMPTY = configFile("empty.js", `export default {};`);
const STAGING = configFile(
	"staging.js",
	`export default {
		overrides: [
			{ mode: ["prod", "staging"], prune: true },
			{ mode: "staging", terse: false },
		],
	};`,
);
const EXPLICIT = configFile(
	"explicit.js",
	`export default { terse: false, overrides: [{ mode: "loud", terse: true }] };`,
);
const UNCONDITIONAL = configFile(
	"unconditional.js",
	`export default { terse: false, overrides: [{ terse: true }] };`,
);

export default {
	name: "Modes as rules: cascade and origin order",
	run: getConfig,
	// Only the options each test is about; the rest of the resolved config is irrelevant here
	check: { subset: true, deep: true },
	afterAll () {
		rmSync(dir, { recursive: true, force: true });
	},
	tests: [
		{
			name: "built-in dev preset",
			arg: { config: EMPTY, mode: "dev" },
			expect: { symlink: true },
		},
		{
			name: "built-in prod preset",
			arg: { config: EMPTY, mode: "prod" },
			expect: { symlink: false, prune: true, terse: true },
		},
		{
			name: "no mode: presets stay dormant",
			arg: { config: EMPTY },
			expect: { prune: false, terse: false },
		},
		{
			name: "mode group (any-of matcher) replaces mode-extends",
			arg: { config: STAGING, mode: "staging" },
			expect: { prune: true, terse: false },
		},
		{
			name: "group rule alone applies to the other listed mode",
			arg: { config: STAGING, mode: "prod" },
			expect: { prune: true, terse: true },
		},
		{
			name: "explicit top-level value beats a built-in preset",
			async run (options) {
				let config = await getConfig(options);
				return config.terse;
			},
			arg: { config: EXPLICIT, mode: "prod" },
			expect: false,
		},
		{
			name: "a user mode rule beats a top-level value",
			arg: { config: EXPLICIT, mode: "loud" },
			expect: { terse: true },
		},
		{
			name: "an unconditional rule beats a top-level value",
			arg: { config: UNCONDITIONAL },
			expect: { terse: true },
		},
		{
			name: "unknown active mode warns but still resolves",
			async run (options) {
				let warned = "";
				let original = console.warn;
				console.warn = msg => (warned += msg);
				try {
					await getConfig(options);
				}
				finally {
					console.warn = original;
				}
				return warned.includes(`Unknown mode "nonexistent"`);
			},
			arg: { config: STAGING, mode: "nonexistent" },
			expect: true,
		},
	],
};
