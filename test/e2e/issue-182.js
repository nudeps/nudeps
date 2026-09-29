import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const INSTALL = import.meta.resolve("../../src/install.js");

// nudeps is already a devDependency, so install() skips `npm install` and only adds the scripts.
const PKG = { name: "issue-182-repro", type: "module", devDependencies: { nudeps: "*" } };
const HOOKS = { dependencies: "nudeps", prepare: "nudeps" };

export default {
	name: "install adds the scripts the host needs (issue #182)",
	description: "https://github.com/nudeps/nudeps/issues/182",
	run ({ scripts, options, files = {} }) {
		let dir = mkdtempSync(join(tmpdir(), "nudeps-issue-182-"));

		try {
			writeFileSync(join(dir, "package.json"), JSON.stringify({ ...PKG, scripts }));
			for (let [name, content] of Object.entries(files)) {
				writeFileSync(join(dir, name), content);
			}

			// A child process gets its own cwd, which parallel sibling tests would otherwise share
			let code = `import install from ${JSON.stringify(INSTALL)}; await install(${JSON.stringify(options)});`;
			execFileSync(process.execPath, ["-e", code], { cwd: dir });
			return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).scripts;
		}
		finally {
			rmSync(dir, { recursive: true, force: true });
		}
	},
	tests: [
		{
			name: "Vercel gets a build script, or it never runs npm install and nudeps",
			arg: { options: { host: "vercel" } },
			expect: { ...HOOKS, build: "nudeps" },
		},
		{
			name: "A vercel.json is enough, since Git-connected projects rarely set host",
			arg: { files: { "vercel.json": "{}" } },
			expect: { ...HOOKS, build: "nudeps" },
		},
		{
			name: "An existing build script already makes Vercel install, so it stays as is",
			arg: { scripts: { build: "eleventy" }, options: { host: "vercel" } },
			expect: { build: "eleventy", ...HOOKS },
		},
		{
			name: "Other hosts get no build script",
			arg: { options: { host: "netlify" } },
			expect: HOOKS,
		},
	],
};
