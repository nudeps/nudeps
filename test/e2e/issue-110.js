import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const INSTALL = import.meta.resolve("../../src/install.js");

// nudeps is already a devDependency, so install() skips `npm install` and only adds the hooks.
const PKG = { name: "issue-110-repro", type: "module", devDependencies: { nudeps: "*" } };
const HOOKED = { ...PKG, scripts: { dependencies: "nudeps", prepare: "nudeps" } };

export default {
	name: "install preserves package.json indentation (issue #110)",
	description: "https://github.com/nudeps/nudeps/issues/110",
	run (indent) {
		let dir = mkdtempSync(join(tmpdir(), "nudeps-issue-110-"));

		try {
			writeFileSync(join(dir, "package.json"), JSON.stringify(PKG, null, indent) + "\n");
			// A child process gets its own cwd, which parallel sibling tests would otherwise share
			let code = `import install from ${JSON.stringify(INSTALL)}; await install();`;
			execFileSync(process.execPath, ["-e", code], { cwd: dir });
			return readFileSync(join(dir, "package.json"), "utf8");
		}
		finally {
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
