import install from "../../src/install.js";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// nudeps is already a devDependency, so install() skips `npm install` and only adds the hooks.
const PKG = { name: "issue-110-repro", type: "module", devDependencies: { nudeps: "*" } };
const HOOKED = { ...PKG, scripts: { dependencies: "npx nudeps", prepare: "npx nudeps" } };

export default {
	name: "install preserves package.json indentation (issue #110)",
	description: "https://github.com/nudeps/nudeps/issues/110",
	async run (indent) {
		let dir = mkdtempSync(join(tmpdir(), "nudeps-issue-110-"));
		let cwd = process.cwd();

		try {
			writeFileSync(join(dir, "package.json"), JSON.stringify(PKG, null, indent) + "\n");
			process.chdir(dir);
			await install();
			return readFileSync(join(dir, "package.json"), "utf8");
		}
		finally {
			process.chdir(cwd);
			rmSync(dir, { recursive: true, force: true });
		}
	},
	getExpect: indent => JSON.stringify(HOOKED, null, indent) + "\n",
	tests: [
		{ name: "Tabs", arg: "\t" },
		{ name: "2 spaces", arg: 2 },
		{ name: "4 spaces", arg: 4 },
	],
};
