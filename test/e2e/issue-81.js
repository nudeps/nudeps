import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const NUDEPS_ROOT = resolve(import.meta.dirname, "../..");

export default {
	name: "prune keeps packages an ESM entry point loads through the shim's require() (issue #81)",
	description:
		"https://github.com/nudeps/nudeps/issues/81 — JSPM traces a file as either ESM or CommonJS, " +
		"so it never sees `require()` calls in an ESM file, and `prune` used to drop those packages.",
	async run () {
		let dir = mkdtempSync(join(tmpdir(), "nudeps-issue-81-"));
		try {
			for (let name of ["cjs-dep", "backtick-dep", "unused-dep"]) {
				mkdirSync(join(dir, name));
				writeFileSync(
					join(dir, name, "package.json"),
					JSON.stringify({ name, version: "1.0.0", main: "index.js" }),
				);
				writeFileSync(join(dir, name, "index.js"), "module.exports = { ok: true };\n");
			}

			writeFileSync(
				join(dir, "package.json"),
				JSON.stringify({
					name: "issue-81-repro",
					version: "1.0.0",
					type: "module",
					main: "index.js",
					dependencies: {
						"cjs-dep": "file:./cjs-dep",
						"backtick-dep": "file:./backtick-dep",
						"unused-dep": "file:./unused-dep",
					},
					devDependencies: { nudeps: `file:${NUDEPS_ROOT}` },
				}),
			);
			writeFileSync(
				join(dir, "index.js"),
				`import { require } from "cjs-browser-shim";\n` +
					`const { ok } = require("cjs-dep");\n` +
					"const extra = require(`backtick-dep`);\n",
			);

			let env = { ...process.env, npm_config_audit: "false", npm_config_fund: "false" };
			let exec = cmd => execSync(cmd, { cwd: dir, env, stdio: "ignore" });

			exec("npm install");
			exec("npx nudeps --prune");

			let map = readFileSync(join(dir, "importmap.js"), "utf8");
			// Sorted: the map's key order isn't what's under test
			return [...map.matchAll(/"([a-z]+-dep)":/g)].map(([, s]) => s).sort();
		}
		finally {
			rmSync(dir, { recursive: true, force: true });
		}
	},
	// unused-dep is the control: it proves prune is on, so the other two survive only through require()
	expect: ["backtick-dep", "cjs-dep"],
};
