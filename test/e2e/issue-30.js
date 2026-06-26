import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const NUDEPS_ROOT = resolve(import.meta.dirname, "../..");

// https://github.com/nudeps/nudeps/issues/30 + https://github.com/nudeps/nudeps/issues/144.
// When the root entry point imports a package that isn't installed, JSPM's root install fails with
// "Cannot find package …" and never maps the root package to its own entry point. nudeps recovers
// by resolving the entry point itself and pinning it (Nudeps.installAll). Two regressions this
// guards: (a) the fallback's node:url imports going missing → it throws and pins nothing (#30 path);
// (b) the pin being applied before finalize()'s cjs-browser-shim install, which rebuilds the map
// and wipes it (#144). This repro forces the fallback (index.js imports a never-installed package)
// under the default CJS handling — so the shim install runs — and asserts the root self-reference
// still lands in the map.
export default {
	name: "Root package is mapped to its entry point when the entry imports a missing package (issue #30, #144)",
	async run () {
		let tmpDir = mkdtempSync(join(tmpdir(), "nudeps-issue-30-"));
		try {
			writeFileSync(
				join(tmpDir, "package.json"),
				JSON.stringify({
					name: "issue-30-repro",
					version: "1.0.0",
					type: "module",
					main: "index.js",
					dependencies: { nudeps: `file:${NUDEPS_ROOT}` },
				}),
			);

			// Entry point imports a package that is never installed → JSPM's root trace fails.
			writeFileSync(join(tmpDir, "index.js"), `import "this-package-is-not-installed";\n`);

			let env = { ...process.env, npm_config_audit: "false", npm_config_fund: "false" };
			let exec = cmd => execSync(cmd, { cwd: tmpDir, env, stdio: "ignore" });

			exec("npm install");
			exec("npx nudeps");

			let map = readFileSync(join(tmpDir, "importmap.js"), "utf8");
			return map.match(/"issue-30-repro":\s*"([^"]+)"/)?.[1] ?? null;
		}
		finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	},
	// The root package must map to its own entry point — proving the fallback ran and survived
	// finalize()'s shim install.
	check: entry => typeof entry === "string" && entry.includes("index.js"),
	expect: true,
};
