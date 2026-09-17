import { execSync } from "node:child_process";
import { existsSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readJSONSync } from "../../src/util.js";

const NUDEPS_ROOT = resolve(import.meta.dirname, "../..");

/**
 * `app` depends on `../lib`; both run nudeps. Running nudeps in `app` registers it as a local
 * dependent of `lib`, which is the state `--init` in `lib` used to destroy.
 */
function setup () {
	let dir = mkdtempSync(join(tmpdir(), "nudeps-issue-164-"));
	let [app, lib] = ["app", "lib"].map(name => {
		let repo = join(dir, name);
		mkdirSync(repo);
		writeFileSync(join(repo, "index.js"), "export default 1;\n");
		return repo;
	});

	let pkg = (repo, extra) =>
		writeFileSync(
			join(repo, "package.json"),
			JSON.stringify({
				name: `${repo.split("/").at(-1)}-164`,
				version: "1.0.0",
				type: "module",
				main: "index.js",
				exports: { ".": "./index.js" },
				devDependencies: { nudeps: `file:${NUDEPS_ROOT}` },
				scripts: { dependencies: "npx nudeps" },
				...extra,
			}) + "\n",
		);

	pkg(lib, {});
	pkg(app, { dependencies: { "lib-164": "file:../lib" } });

	let env = { ...process.env, npm_config_audit: "false", npm_config_fund: "false" };
	execSync("npm install", { cwd: lib, env, stdio: "ignore" });
	execSync("npm install", { cwd: app, env, stdio: "ignore" });
	execSync("npx nudeps", { cwd: app, env, stdio: "ignore" });

	return { dir, app, lib };
}

const cli = (args, cwd) =>
	execSync(`node ${join(NUDEPS_ROOT, "src/cli/index.js")} ${args}`, { cwd, stdio: "ignore" });

// https://github.com/nudeps/nudeps/issues/164
// `--init` clears `.nudeps` to force a cold rebuild, which took `local-dependents.json` with it.
// That file is topology, not cached output: nothing re-registers a dependent except that dependent
// running nudeps itself, so a wipe stopped propagation until someone happened to reinstall in every
// dependent — and after #166 the dependency's hook survives the wipe, so it keeps firing, reads an
// absent list and notifies nobody, with nothing logged to show for it.
export default {
	name: "`--init` keeps the local dependents list (issue #164)",
	tests: [
		{
			name: "The list survives",
			run () {
				let { dir, lib } = setup();

				try {
					cli("--init", lib);

					return readJSONSync(join(lib, ".nudeps/local-dependents.json"));
				}
				finally {
					rmSync(dir, { recursive: true, force: true });
				}
			},
			expect: ["../app"],
		},
		{
			name: "The cache is still cleared",
			description:
				"Preserving topology must not turn `--init` into a no-op — the cold rebuild is the point.",
			run () {
				let { dir, lib } = setup();
				let exports = join(lib, ".nudeps/exports.json");

				try {
					writeFileSync(exports, "{}\n");
					cli("--init", lib);

					return existsSync(exports);
				}
				finally {
					rmSync(dir, { recursive: true, force: true });
				}
			},
			expect: false,
		},
	],
};
