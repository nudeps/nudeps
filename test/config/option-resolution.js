import { getConfig } from "../../src/config.js";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// getConfig() reads the config file off disk, so these are written out rather than passed in
let dir = mkdtempSync(join(tmpdir(), "nudeps-config-"));
function configFile (name, config) {
	let file = join(dir, name);
	writeFileSync(file, `export default ${JSON.stringify(config)};`);
	return file;
}

const CONFIG = configFile("nudeps.js", { dir: "from-config", mode: "prod" });
// Same, minus the mode, so `defaults.mode` gets a chance to apply
const NO_MODE = configFile("no-mode.js", { dir: "from-config" });

export default {
	name: "getConfig() precedence: args > config file > mode preset > defaults",
	run: getConfig,
	// Only the options each test is about; the rest of the resolved config is irrelevant here
	check: { subset: true, deep: true },
	afterAll () {
		rmSync(dir, { recursive: true, force: true });
	},
	tests: [
		{
			name: "defaults fill in options no other layer sets, beating built-in option defaults",
			arg: { config: CONFIG, defaults: { map: "dist/importmap.js", root: "dist" } },
			expect: { map: "dist/importmap.js", root: "dist" },
		},
		{
			name: "config file beats defaults",
			arg: { config: CONFIG, defaults: { dir: "from-defaults" } },
			expect: { dir: "from-config" },
		},
		{
			name: "args beat defaults",
			arg: { config: CONFIG, dir: "from-args", defaults: { dir: "from-defaults" } },
			expect: { dir: "from-args" },
		},
		{
			name: "mode preset beats defaults",
			arg: { config: CONFIG, defaults: { terse: false, prune: false } },
			expect: { terse: true, prune: true },
		},
		{
			name: "defaults.mode applies when no other layer sets a mode",
			arg: { config: NO_MODE, defaults: { mode: "prod" } },
			expect: { symlink: false, prune: true, terse: true },
		},
		{
			name: "config file mode beats defaults.mode",
			arg: { config: CONFIG, defaults: { mode: "dev" } },
			expect: { symlink: false },
		},
		{
			name: "defaults.config picks the config file to read",
			arg: { defaults: { config: CONFIG } },
			expect: { dir: "from-config" },
		},
		{
			name: "defaults does not leak into the resolved options",
			async run (options) {
				return "defaults" in (await getConfig(options));
			},
			arg: { config: CONFIG, defaults: { dir: "from-defaults" } },
			expect: false,
		},
	],
};
