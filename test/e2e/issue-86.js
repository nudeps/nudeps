import { execSync, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readJSONSync } from "../../src/util.js";

const NUDEPS_ROOT = resolve(import.meta.dirname, "../..");

/**
 * Build a dependent (`app`) with a local dependency (`dep`) installed via `file:`, run nudeps in
 * the dependent, and hand back both repos' paths. `depScripts` seeds the dep's package.json so we
 * can exercise what nudeps does to a local dep that does, or doesn't, already notify its dependents.
 */
function setup (depScripts) {
	let dir = mkdtempSync(join(tmpdir(), "nudeps-issue-86-"));
	let dep = join(dir, "dep");
	let app = join(dir, "app");
	mkdirSync(dep);
	mkdirSync(app);

	// The local dep deliberately has no nudeps anywhere — that's the whole point of #86.
	writeFileSync(
		join(dep, "package.json"),
		JSON.stringify(
			{
				name: "dep-86",
				version: "1.0.0",
				type: "module",
				main: "index.js",
				exports: { ".": "./index.js" },
				...(depScripts && { scripts: depScripts }),
			},
			null,
			"\t",
		) + "\n",
	);
	writeFileSync(join(dep, "index.js"), "export default 1;\n");

	writeFileSync(
		join(app, "package.json"),
		JSON.stringify({
			name: "app-86",
			version: "1.0.0",
			type: "module",
			dependencies: { "dep-86": "file:../dep" },
			devDependencies: { nudeps: `file:${NUDEPS_ROOT}` },
			scripts: { dependencies: "npx nudeps" },
		}),
	);

	let env = { ...process.env, npm_config_audit: "false", npm_config_fund: "false" };
	execSync("npm install", { cwd: app, env, stdio: "ignore" });
	execSync("npx nudeps", { cwd: app, env, stdio: "ignore" });

	return { dir, dep, app };
}

const readScripts = dep => readFileSync(join(dep, "package.json"), "utf8");

const cli = (command, cwd) =>
	execSync(`node ${join(NUDEPS_ROOT, "src/cli/index.js")} ${command}`, { cwd, stdio: "ignore" });

/**
 * A three-link chain: `app` → `lib` → `util`, where only `app` has nudeps. Lea's example in #86 is
 * "a library with no frontend", and such a library can have local dependencies of its own — so the
 * light path has to track upstream as well as notify downstream, or the chain dies at `lib`.
 */
function setupChain () {
	let dir = mkdtempSync(join(tmpdir(), "nudeps-issue-86-chain-"));
	let [app, lib, util] = ["app", "lib", "util"].map(name => {
		let repo = join(dir, name);
		mkdirSync(repo);
		writeFileSync(join(repo, "index.js"), "export default 1;\n");
		return repo;
	});

	let pkg = (repo, extra) =>
		writeFileSync(
			join(repo, "package.json"),
			JSON.stringify(
				{
					name: `${repo.split("/").at(-1)}-chain`,
					version: "1.0.0",
					type: "module",
					main: "index.js",
					exports: { ".": "./index.js" },
					...extra,
				},
				null,
				"\t",
			) + "\n",
		);

	pkg(util, {});
	pkg(lib, { dependencies: { "util-chain": "file:../util" } });
	pkg(app, {
		dependencies: { "lib-chain": "file:../lib" },
		devDependencies: { nudeps: `file:${NUDEPS_ROOT}` },
		scripts: { dependencies: "npx nudeps" },
	});

	let env = { ...process.env, npm_config_audit: "false", npm_config_fund: "false" };
	execSync("npm install", { cwd: lib, env, stdio: "ignore" });
	execSync("npm install", { cwd: app, env, stdio: "ignore" });
	execSync("npx nudeps", { cwd: app, env, stdio: "ignore" });

	return { dir, app, lib, util };
}

/**
 * Two mutually-dependent local packages, neither with nudeps. Registration is written by hand rather
 * than bootstrapped, because bootstrapping it is itself what used to hang. The hooks invoke the CLI
 * directly instead of `npx nudeps dependents`: identical code path, minus resolving a package from the
 * registry that these repos deliberately do not have.
 */
function setupCycle () {
	let dir = mkdtempSync(join(tmpdir(), "nudeps-issue-86-cycle-"));
	let [lib, util] = ["lib", "util"].map(name => {
		let repo = join(dir, name);
		mkdirSync(join(repo, ".nudeps"), { recursive: true });
		writeFileSync(join(repo, "index.js"), "export default 1;\n");
		return repo;
	});

	let hook = `node ${join(NUDEPS_ROOT, "src/cli/index.js")} dependents`;
	for (let [repo, other] of [
		[lib, "util"],
		[util, "lib"],
	]) {
		writeFileSync(
			join(repo, "package.json"),
			JSON.stringify({
				name: `${other === "util" ? "lib" : "util"}-cycle`,
				version: "1.0.0",
				type: "module",
				main: "index.js",
				exports: { ".": "./index.js" },
				dependencies: { [`${other}-cycle`]: `file:../${other}` },
				scripts: { dependencies: hook },
			}),
		);
		writeFileSync(join(repo, ".nudeps/local-dependents.json"), JSON.stringify([`../${other}`]));
	}

	let env = { ...process.env, npm_config_audit: "false", npm_config_fund: "false" };
	execSync("npm install", { cwd: lib, env, stdio: "ignore" });
	execSync("npm install", { cwd: util, env, stdio: "ignore" });

	return { dir, lib, util };
}

export default {
	name: "Local deps need no nudeps, just a `dependencies` hook (issue #86)",
	description: "https://github.com/nudeps/nudeps/issues/86",
	tests: [
		{
			name: "Hook written into the local dep",
			description:
				"Before #86 nudeps skipped any dep without nudeps installed, so nothing was written.",
			run (depScripts) {
				let { dir, dep } = setup(depScripts);

				try {
					return JSON.parse(readScripts(dep)).scripts;
				}
				finally {
					rmSync(dir, { recursive: true, force: true });
				}
			},
			tests: [
				{
					name: "Dep with no scripts gets the hook",
					arg: undefined,
					expect: { dependencies: "npx nudeps dependents" },
				},
				{
					name: "Dep already running nudeps is left alone",
					description:
						"It notifies its dependents anyway, so a second command would notify them twice. No `prepare` here: npm runs that when installing a `file:` dep, and this dep has no nudeps to run.",
					arg: { dependencies: "npx nudeps" },
					expect: { dependencies: "npx nudeps" },
				},
				{
					name: "Existing `dependencies` script is preserved",
					description:
						"We are editing a repo we do not own, so never clobber what is there.",
					arg: { dependencies: "npm run build" },
					expect: {
						dependencies: "npm run build",
						predependencies: "npx nudeps dependents",
					},
				},
				{
					name: "Dep running nudeps from `predependencies` is left alone",
					description: "The check spans all three hooks, not just `dependencies`.",
					arg: { predependencies: "npx nudeps" },
					expect: { predependencies: "npx nudeps" },
				},
				{
					name: "Dep with every hook taken is left alone",
					description:
						"Nowhere to put the command without overwriting someone else's script, so nudeps warns instead of writing.",
					arg: { dependencies: "a", predependencies: "b", postdependencies: "c" },
					expect: { dependencies: "a", predependencies: "b", postdependencies: "c" },
				},
			],
		},
		{
			name: "Dependent is registered in the local dep",
			description:
				"Registration is what lets the dep notify us later, and it must not depend on whether the dep runs nudeps — leaving it alone is only about its package.json.",
			run (depScripts) {
				let { dir, dep } = setup(depScripts);

				try {
					return readFileSync(join(dep, ".nudeps/local-dependents.json"), "utf8");
				}
				finally {
					rmSync(dir, { recursive: true, force: true });
				}
			},
			getExpect: () => JSON.stringify(["../app"], null, "\t") + "\n",
			tests: [
				{ name: "Dep without nudeps", arg: undefined },
				{ name: "Dep already running nudeps", arg: { dependencies: "npx nudeps" } },
			],
		},
		{
			// The payoff: the dep runs the hook nudeps just wrote it, without nudeps installed
			// anywhere in its own tree, and its dependent regenerates. Invoked through the CLI
			// entry point directly, which is what `npx nudeps dependents` resolves to.
			name: "`nudeps dependents` regenerates the dependent from a nudeps-free dep",
			run () {
				let { dir, dep, app } = setup();
				let map = join(app, "importmap.js");

				try {
					rmSync(map);
					execSync(`node ${join(NUDEPS_ROOT, "src/cli/index.js")} dependents`, {
						cwd: dep,
						stdio: "ignore",
					});

					return existsSync(map);
				}
				finally {
					rmSync(dir, { recursive: true, force: true });
				}
			},
			expect: true,
		},
		{
			// #86 asks for a path that "only tracks and updates dependents". Updating alone leaves
			// `util` invisible to everyone: nothing would ever tell `lib` that `util` changed.
			name: "`nudeps dependents` tracks the dep's own local dependencies",
			run () {
				let { dir, lib, util } = setupChain();

				try {
					cli("dependents", lib);

					return {
						hook: JSON.parse(readScripts(util)).scripts?.dependencies,
						dependents: readJSONSync(join(util, ".nudeps/local-dependents.json")),
					};
				}
				finally {
					rmSync(dir, { recursive: true, force: true });
				}
			},
			expect: { hook: "npx nudeps dependents", dependents: ["../lib"] },
		},
		{
			name: "A change in the deepest dep reaches the app through the chain",
			description:
				"The whole point of #86: `util` -> `lib` -> `app` with nudeps only in `app`. Hooks are rewritten to invoke the CLI by path, since npx would resolve nudeps from the registry and these repos deliberately have none.",
			run () {
				let { dir, app, lib, util } = setupChain();
				let map = join(app, "importmap.js");

				try {
					// One run in `lib` wires `util`, so every link has a hook to rewrite
					cli("dependents", lib);

					for (let repo of [lib, util]) {
						let pkgPath = join(repo, "package.json");
						let pkg = readJSONSync(pkgPath);
						pkg.scripts.dependencies = `node ${join(NUDEPS_ROOT, "src/cli/index.js")} dependents`;
						writeFileSync(pkgPath, JSON.stringify(pkg, null, "\t") + "\n");
					}

					rmSync(map);
					cli("dependents", util);

					return existsSync(map);
				}
				finally {
					rmSync(dir, { recursive: true, force: true });
				}
			},
			expect: true,
		},
		{
			// Cycle termination used to be a side effect of the `mapChanged` gate in the full path.
			// Once nudeps-free deps became first-class propagators, a cycle of them had no gate
			// anywhere in the loop and ran forever (measured: 62 hops in 30s, still going).
			name: "Propagation terminates in a cycle of nudeps-free deps",
			// `detached` puts the cascade in its own process group so a regression can be killed off
			// as a whole. An execSync timeout would only reap the first hop and leave the rest looping.
			async run () {
				let { dir, util } = setupCycle();
				let child = spawn("node", [join(NUDEPS_ROOT, "src/cli/index.js"), "dependents"], {
					cwd: util,
					stdio: "ignore",
					detached: true,
				});

				try {
					return await Promise.race([
						new Promise(resolve => child.on("exit", () => resolve("terminated"))),
						new Promise(resolve => setTimeout(() => resolve("still looping"), 20_000)),
					]);
				}
				finally {
					try {
						process.kill(-child.pid, "SIGKILL");
					}
					catch {
						// Already exited — nothing to reap
					}
					rmSync(dir, { recursive: true, force: true });
				}
			},
			expect: "terminated",
		},
		{
			// A workspace sibling shares our lockfile, and the root already delegates to every child
			// via `npm run dependencies --workspaces`. A hook there would duplicate that cascade and
			// edit a file in the same repo, which is not what a hook in someone else's repo buys us.
			name: "Workspace siblings are left alone",
			run () {
				let dir = mkdtempSync(join(tmpdir(), "nudeps-issue-86-ws-"));
				let child = name => join(dir, "packages", name);
				mkdirSync(join(dir, "packages/app"), { recursive: true });
				mkdirSync(child("lib"));

				writeFileSync(
					join(dir, "package.json"),
					JSON.stringify({
						name: "ws-root",
						version: "1.0.0",
						private: true,
						type: "module",
						workspaces: ["packages/*"],
					}),
				);
				writeFileSync(
					join(child("lib"), "package.json"),
					JSON.stringify({
						name: "@ws/lib",
						version: "1.0.0",
						type: "module",
						main: "index.js",
						exports: { ".": "./index.js" },
					}),
				);
				writeFileSync(join(child("lib"), "index.js"), "export default 1;\n");
				writeFileSync(
					join(child("app"), "package.json"),
					JSON.stringify({
						name: "@ws/app",
						version: "1.0.0",
						type: "module",
						dependencies: { "@ws/lib": "^1.0.0" },
						devDependencies: { nudeps: `file:${NUDEPS_ROOT}` },
					}),
				);

				let env = { ...process.env, npm_config_audit: "false", npm_config_fund: "false" };

				try {
					execSync("npm install", { cwd: dir, env, stdio: "ignore" });
					execSync("npx nudeps", { cwd: child("app"), env, stdio: "ignore" });

					return JSON.parse(readScripts(child("lib"))).scripts;
				}
				finally {
					rmSync(dir, { recursive: true, force: true });
				}
			},
			expect: undefined,
		},
		{
			// The dep's package.json is a tracked file in its own repo — respect its formatting (#110).
			name: "Dep's package.json indentation is preserved",
			run () {
				let { dir, dep } = setup();

				try {
					return readScripts(dep).includes('\n\t"scripts"');
				}
				finally {
					rmSync(dir, { recursive: true, force: true });
				}
			},
			expect: true,
		},
	],
};
