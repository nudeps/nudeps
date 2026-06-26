import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const NUDEPS_ROOT = resolve(import.meta.dirname, "../..");

// The full forceDependencies contract, under `prune: true`, on one package (`mitt`):
//   - additionalDependencies → pruned away (control: proves prune really drops it)
//   - forceDependencies       → kept (the feature)
//   - forceDependencies + exclude → still dropped, with a warning (exclude wins over force)
// mitt is a devDependency and the entry point imports nothing, so it only reaches the map via
// injection — exactly the intended use case (a dev-only client lib you always want present).
export default {
	name: "forceDependencies survives prune but still respects exclude",
	async run () {
		let tmpDir = mkdtempSync(join(tmpdir(), "nudeps-force-deps-"));
		try {
			writeFileSync(
				join(tmpDir, "package.json"),
				JSON.stringify({
					name: "force-deps-repro",
					version: "1.0.0",
					type: "module",
					main: "index.js",
					dependencies: { nudeps: `file:${NUDEPS_ROOT}` },
					devDependencies: { mitt: "3.0.1" },
				}),
			);

			// Entry point imports nothing, so prune has no reason to keep mitt.
			writeFileSync(join(tmpDir, "index.js"), "export const ready = true;\n");

			// One build script, three modes. init: true clears the cache so the runs are independent.
			writeFileSync(
				join(tmpDir, "build.mjs"),
				`import nudeps from "nudeps";\n` +
					`let opts = { prune: true, init: true };\n` +
					`let mode = process.env.MODE;\n` +
					`if (mode === "force") { opts.forceDependencies = ["mitt"]; }\n` +
					`else if (mode === "contradiction") { opts.forceDependencies = ["mitt"]; opts.exclude = ["mitt"]; }\n` +
					`else { opts.additionalDependencies = ["mitt"]; }\n` +
					`await nudeps(opts);\n`,
			);

			let env = { ...process.env, npm_config_audit: "false", npm_config_fund: "false" };
			let run = mode =>
				execSync("node build.mjs 2>&1", {
					cwd: tmpDir,
					env: { ...env, MODE: mode },
					encoding: "utf8",
				});
			let mittUrl = () =>
				readFileSync(join(tmpDir, "importmap.js"), "utf8").match(
					/"mitt":\s*"([^"]+)"/,
				)?.[1] ?? null;

			execSync("npm install", { cwd: tmpDir, env, stdio: "ignore" });

			run("additional"); // control: additionalDependencies is pruned away
			let pruned = mittUrl();

			run("force"); // forceDependencies survives the prune
			let forced = mittUrl();

			let output = run("contradiction"); // exclude wins over force, with a warning
			let excluded = mittUrl();
			let warned = /exclude wins/i.test(output);

			return { pruned, forced, excluded, warned };
		}
		finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	},
	// Control dropped mitt; force brought it back (copied, versioned); exclude dropped it again and warned.
	check: ({ pruned, forced, excluded, warned }) =>
		pruned === null &&
		typeof forced === "string" &&
		forced.includes("mitt@") &&
		excluded === null &&
		warned === true,
	expect: true,
};
