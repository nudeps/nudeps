import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const NUDEPS_ROOT = resolve(import.meta.dirname, "../..");

export default {
	name: "An unparseable file doesn't cost a package its declared exports (issue #160)",
	description:
		"https://github.com/nudeps/nudeps/issues/160 — a `./*` export hands JSPM every file in the " +
		"package, and one that fails to trace used to abort the install: `three` lost `three/addons`.",
	async run () {
		let dir = mkdtempSync(join(tmpdir(), "nudeps-issue-160-"));
		try {
			let dep = join(dir, "wildcard-dep");
			mkdirSync(dep);
			writeFileSync(
				join(dep, "package.json"),
				JSON.stringify({
					name: "wildcard-dep",
					version: "1.0.0",
					type: "module",
					exports: { ".": "./index.js", "./extra": "./extra.js", "./*": "./*" },
				}),
			);
			writeFileSync(join(dep, "index.js"), "export const main = 1;\n");
			writeFileSync(join(dep, "extra.js"), "export const extra = 2;\n");

			// The two ways a wildcard-exposed file fails to trace: unparseable, and parseable but
			// importing something absent. The second only fails once its own deps are walked, so it
			// also covers the transitive case — a skipped subpath must not resurface via a survivor.
			writeFileSync(join(dep, "BROKEN.md"), "# Changelog\n\nimport {\n");
			writeFileSync(join(dep, "build.js"), `import "never-installed-package";\n`);

			writeFileSync(
				join(dir, "package.json"),
				JSON.stringify({
					name: "issue-160-repro",
					version: "1.0.0",
					type: "module",
					main: "index.js",
					dependencies: { "wildcard-dep": "file:./wildcard-dep" },
					devDependencies: { nudeps: `file:${NUDEPS_ROOT}` },
				}),
			);
			writeFileSync(join(dir, "index.js"), `import "wildcard-dep";\n`);

			let env = { ...process.env, npm_config_audit: "false", npm_config_fund: "false" };
			let exec = cmd => execSync(cmd, { cwd: dir, env, stdio: "ignore" });

			exec("npm install");
			exec("npx nudeps");

			let map = readFileSync(join(dir, "importmap.js"), "utf8");
			// Sorted: the map's key order isn't what's under test
			return [...map.matchAll(/"(wildcard-dep[^"]*)":/g)].map(([, s]) => s).sort();
		}
		finally {
			rmSync(dir, { recursive: true, force: true });
		}
	},
	// `wildcard-dep/extra` is what disappears when one bad file aborts the trace
	expect: ["wildcard-dep", "wildcard-dep/", "wildcard-dep/extra"],
};
