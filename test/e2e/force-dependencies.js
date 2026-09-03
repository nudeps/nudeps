import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const NUDEPS_ROOT = resolve(import.meta.dirname, "../..");

// The full include contract, under `prune: true`, on one package (`mitt`):
//   - include: true    → pruned away (control: proves prune really drops it)
//   - include: "force" → kept (the feature)
//   - a later include: false rule → dropped again (the cascade resolves the contradiction)
// mitt is a devDependency and the entry point imports nothing, so it only reaches the map via
// injection — exactly the intended use case (a dev-only client lib you always want present).
export default {
	name: 'include: "force" survives prune; a later include: false wins the cascade',
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
					`if (mode === "force") { opts.overrides = [{ name: "mitt", include: "force" }]; }\n` +
					`else if (mode === "contradiction") { opts.overrides = [{ name: "mitt", include: "force" }, { name: "mitt", include: false }]; }\n` +
					`else { opts.overrides = [{ name: "mitt", include: true }]; }\n` +
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

			run("additional"); // control: include: true is pruned away
			let pruned = mittUrl();

			run("force"); // include: "force" survives the prune
			let forced = mittUrl();

			run("contradiction"); // the later include: false rule wins
			let excluded = mittUrl();

			return { pruned, forced, excluded };
		}
		finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	},
	// Control dropped mitt; force brought it back (copied, versioned); the later rule dropped it again.
	check: ({ pruned, forced, excluded }) =>
		pruned === null &&
		typeof forced === "string" &&
		forced.includes("mitt@") &&
		excluded === null,
	expect: true,
};
