import { execSync } from "node:child_process";
import { existsSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { writeJSONSync } from "../../src/util.js";

const NUDEPS_ROOT = resolve(import.meta.dirname, "../..");

/**
 * `lib` with two registered dependents, one of which no longer exists on disk. Registration is
 * written directly: reaching this state through npm would mean installing a repo only to delete it.
 */
function setup () {
	let dir = mkdtempSync(join(tmpdir(), "nudeps-issue-163-"));
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
				name: `${repo.split("/").at(-1)}-163`,
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
	pkg(app, { dependencies: { "lib-163": "file:../lib" } });

	let env = { ...process.env, npm_config_audit: "false", npm_config_fund: "false" };
	execSync("npm install", { cwd: lib, env, stdio: "ignore" });
	execSync("npm install", { cwd: app, env, stdio: "ignore" });
	execSync("npx nudeps", { cwd: app, env, stdio: "ignore" });

	// `../ghost` was never created, so it stands for a dependent that has since been deleted.
	// It goes first so that an implementation which gives up on the first failure is caught.
	writeJSONSync(join(lib, ".nudeps/local-dependents.json"), ["../ghost", "../app"]);

	return { dir, app, lib };
}

// https://github.com/nudeps/nudeps/issues/163
// `local-dependents.json` only ever grew, so a dependent that was deleted stayed on the list and
// `npm run dependencies` was spawned into a directory that isn't there — an error logged on every
// run, forever. Preserving the list across `--init` (#164) removed the accidental pruning that
// wiping it used to provide, so skipping absent dependents is what keeps propagation quiet.
// Note: a dependent that still exists but no longer depends on us is the other half of #163 and is
// not addressed here — the dep cannot see that cheaply, so the dependent has to deregister itself.
export default {
	name: "A dependent that no longer exists is skipped (issue #163)",
	run () {
		let { dir, app, lib } = setup();
		let map = join(app, "importmap.js");

		try {
			// `lib`'s own install already generated its map, and an unchanged map stops propagation
			// before the list is ever read — so give this run something to propagate.
			rmSync(join(lib, "importmap.js"));
			rmSync(map);

			// The propagation failure is logged via console.error, which execSync does not return
			let output = execSync("npx nudeps 2>&1", {
				cwd: lib,
				env: { ...process.env, npm_config_audit: "false", npm_config_fund: "false" },
				encoding: "utf8",
			});

			return {
				failed: output.includes("Failed to propagate"),
				reachedApp: existsSync(map),
			};
		}
		finally {
			rmSync(dir, { recursive: true, force: true });
		}
	},
	// The live dependent must still be reached — skipping the dead one must not skip the list.
	expect: { failed: false, reachedApp: true },
};
