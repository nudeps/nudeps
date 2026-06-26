import { execSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const NUDEPS_ROOT = resolve(import.meta.dirname, "../..");

// https://github.com/nudeps/nudeps/issues/30. When the root entry point imports a package that
// isn't in node_modules, JSPM's root install fails with "Cannot find package …" and nudeps falls
// back to resolving the entry point manually (Nudeps.installAll). That fallback lives in nudeps.js
// but depends on node:url helpers that used to be imported only in index.js — a regression that
// left the fallback throwing a ReferenceError inside its try/catch, surfacing only as a stray
// "Failed to manually resolve …" log. This test forces the fallback (index.js imports a package
// that is never installed) and asserts it both runs (root install fails) and completes cleanly.
//
// NOTE: it deliberately does NOT assert the root self-reference lands in the map. That outcome is
// currently masked by a separate, pre-existing bug — finalize()'s cjs-browser-shim install runs an
// install() after the fallback, which discards the manually-set entry. Strengthen this assertion
// once that is fixed (see the issue tracking the shim-wipe).
export default {
	name: "Root-package fallback runs cleanly when the entry point imports a missing package (issue #30)",
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
			let exec = cmd => execSync(cmd, { cwd: tmpDir, env, encoding: "utf8" });

			exec("npm install");
			// Merge stderr so we see nudeps' error() logs; nudeps exits 0 even when the root install fails.
			return exec("npx nudeps 2>&1");
		}
		finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	},
	// The root install must fail (proving we reached the fallback) AND the manual resolution must
	// not error (proving its imports resolve). A dropped node:url import trips the second clause.
	check: out =>
		out.includes("Failed to install root package") &&
		!out.includes("Failed to manually resolve root package entry point"),
	expect: true,
};
