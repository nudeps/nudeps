import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const NUDEPS_ROOT = resolve(import.meta.dirname, "../..");

/**
 * `app` depends on `lib` packed as a tarball: installed like a registry package, so nudeps copies
 * and caches it, but without the network.
 */
function setup () {
	let dir = mkdtempSync(join(tmpdir(), "nudeps-prepare-write-"));
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
				name: `${repo.split("/").at(-1)}-pw`,
				version: "1.0.0",
				type: "module",
				main: "index.js",
				exports: { ".": "./index.js" },
				...extra,
			}) + "\n",
		);

	pkg(lib, {});
	execSync("npm pack", { cwd: lib, stdio: "ignore" });
	pkg(app, {
		dependencies: { "lib-pw": "file:../lib/lib-pw-1.0.0.tgz" },
		devDependencies: { nudeps: `file:${NUDEPS_ROOT}` },
	});

	let env = { ...process.env, npm_config_audit: "false", npm_config_fund: "false" };
	execSync("npm install", { cwd: app, env, stdio: "ignore" });

	return { dir, app };
}

/**
 * Run a script that uses the `Nudeps` class in a fresh project.
 * @param {string} body - Module code with `Nudeps` and `node:fs` helpers in scope.
 * It must print its result as JSON.
 */
function consumer (body) {
	let { dir, app } = setup();

	try {
		writeFileSync(
			join(app, "build.mjs"),
			`import { Nudeps } from "nudeps";\nimport { existsSync, mkdirSync, rmSync } from "node:fs";\n${body}\n`,
		);

		return JSON.parse(
			execSync("node build.mjs", { cwd: app, encoding: "utf8" }).trim().split("\n").at(-1),
		);
	}
	finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

export default {
	name: "Preparing and writing separately",
	run: consumer,
	tests: [
		{
			name: "prepare()",
			tests: [
				{
					name: "Writes nothing the consumer sees",
					description:
						"prepare() can run long before write(), so it must leave the consumer's output alone until then.",
					arg: `
						let nudeps = new Nudeps();
						await nudeps.prepare();
						console.log(JSON.stringify([nudeps.config.dir, nudeps.config.map].map(existsSync)));
					`,
					expect: [false, false],
				},
				{
					name: "Runs once when write() follows it",
					description:
						"Running it again would fire `prepare-start` and add the host and config hooks a second time.",
					arg: `
						let nudeps = new Nudeps();
						let runs = 0;
						nudeps.hooks.add("prepare-start", () => runs++);
						await nudeps.prepare();
						await nudeps.write();
						console.log(JSON.stringify(runs));
					`,
					expect: 1,
				},
				{
					name: "Does not trust a cache built for another config",
					description:
						"A run that prepares but never writes leaves its cache behind. .nudeps/config.json still describes the run before it. Checking the cache against that file would reuse a cache built for another config. `same` is the control: a matching config does use the cache.",
					arg: `
						await new Nudeps().write();
						let same = new Nudeps();
						await same.prepare();
						await new Nudeps({ terse: true }).prepare();
						let other = new Nudeps();
						await other.prepare();
						let hits = nudeps => nudeps.generator.stats.cacheHits;
						console.log(JSON.stringify({ same: hits(same), other: hits(other) }));
					`,
					expect: { same: 1, other: 0 },
				},
				{
					name: "Leaves a cache the next run can use after --init",
					description:
						"`init` changes how one run starts, not what it resolves, so it must not invalidate the next run's cache. `cold` is the control: --init itself still starts from scratch.",
					arg: `
						await new Nudeps().write();
						let cold = new Nudeps({ init: true });
						await cold.prepare();
						let next = new Nudeps();
						await next.prepare();
						let hits = nudeps => nudeps.generator.stats.cacheHits;
						console.log(JSON.stringify({ cold: hits(cold), next: hits(next) }));
					`,
					expect: { cold: 0, next: 1 },
				},
				{
					name: "Leaves the cache valid when a package's `wireLocalDeps` changes",
					description:
						"It decides what a run edits outside the map, not what it resolves, so toggling it in a rule must keep the cache.",
					arg: `
						let rule = wireLocalDeps => ({ overrides: { "lib-pw": { wireLocalDeps } } });
						await new Nudeps(rule(true)).write();
						let next = new Nudeps(rule(false));
						await next.prepare();
						console.log(JSON.stringify(next.generator.stats.cacheHits));
					`,
					expect: 1,
				},
			],
		},
		{
			name: "write()",
			tests: [
				{
					name: "Restores an output directory cleared after prepare()",
					description:
						"A build between the two calls may clear its output (#152), so what is on disk is read when writing, not when preparing.",
					arg: `
						await new Nudeps().write();
						let nudeps = new Nudeps();
						await nudeps.prepare();
						rmSync(nudeps.config.dir, { recursive: true });
						await nudeps.write();
						console.log(JSON.stringify(existsSync(nudeps.config.dir + "/lib-pw@1.0.0/index.js")));
					`,
					expect: true,
				},
				{
					name: "Runs once when called again",
					description:
						"Each instance writes once. A later build creates a new instance, which traces the dependencies again.",
					arg: `
						let nudeps = new Nudeps();
						let runs = 0;
						nudeps.hooks.add("create-aliases-start", () => runs++);
						await nudeps.write();
						await nudeps.write();
						console.log(JSON.stringify(runs));
					`,
					expect: 1,
				},
				{
					name: "Changing dir cleans up what the old one held",
					description:
						"The old directory is moved into place, so its stale entries must be seen by the cleanup that follows.",
					arg: `
						await new Nudeps({ dir: "old_modules" }).write();
						mkdirSync("old_modules/stale@1.0.0");
						await new Nudeps({ dir: "new_modules" }).write();
						console.log(JSON.stringify(existsSync("new_modules/stale@1.0.0")));
					`,
					expect: false,
				},
				{
					name: "--init with a changed dir removes the old one",
					arg: `
						await new Nudeps({ dir: "old_modules" }).write();
						await new Nudeps({ dir: "new_modules", init: true }).write();
						console.log(JSON.stringify(existsSync("old_modules")));
					`,
					expect: false,
				},
				{
					name: "--init removes an external alias from the last run",
					arg: `
						await new Nudeps({ alias: "../vendor" }).write();
						let before = existsSync("vendor");
						await new Nudeps({ init: true }).write();
						console.log(JSON.stringify({ before, after: existsSync("vendor") }));
					`,
					expect: { before: true, after: false },
				},
			],
		},
	],
};
