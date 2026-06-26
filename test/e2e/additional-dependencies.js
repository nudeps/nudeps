import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const NUDEPS_ROOT = resolve(import.meta.dirname, "../..");

// Reproduces a tool (e.g. a static site generator) injecting its own client library into a
// consumer's import map. `mitt` is present only as a devDependency, so npm flags it dev:true
// in the lockfile and the root trace never reaches it — it lands in the map purely because of
// additionalDependencies. Exercises dev-flag retention too: a dev-flagged package must resolve
// and copy, not just appear as a map entry.
export default {
	name: "additionalDependencies injects a package the host doesn't depend on",
	async run () {
		let tmpDir = mkdtempSync(join(tmpdir(), "nudeps-additional-deps-"));
		try {
			writeFileSync(
				join(tmpDir, "package.json"),
				JSON.stringify({
					name: "additional-deps-repro",
					version: "1.0.0",
					type: "module",
					dependencies: { nudeps: `file:${NUDEPS_ROOT}` },
					devDependencies: { mitt: "3.0.1" },
				}),
			);

			// A consumer calling nudeps programmatically and injecting its own client library.
			writeFileSync(
				join(tmpDir, "build.mjs"),
				`import nudeps from "nudeps";\nawait nudeps({ additionalDependencies: ["mitt"] });\n`,
			);

			let env = { ...process.env, npm_config_audit: "false", npm_config_fund: "false" };
			let exec = cmd => execSync(cmd, { cwd: tmpDir, env, stdio: "ignore" });

			exec("npm install");
			exec("node build.mjs");

			let map = readFileSync(join(tmpDir, "importmap.js"), "utf8");
			return map.match(/"mitt":\s*"([^"]+)"/)?.[1] ?? null;
		}
		finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	},
	// mitt must resolve to a copied, versioned client_modules path — proving it was installed
	// and localized, not left dangling.
	check: url => typeof url === "string" && url.includes("mitt@"),
	expect: true,
};
