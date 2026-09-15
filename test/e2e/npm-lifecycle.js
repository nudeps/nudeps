import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = `node ${JSON.stringify(join(import.meta.dirname, "../../src/cli/index.js"))}`;
// A hook that wraps nudeps in `npx`, so npm's own lifecycle variables never reach it.
const WRAPPED = `npx --no ${CLI}`;
const SKIP = "Skipping import map generation";
const WARNING = "workspace root has no `dependencies` hook";
const DELEGATE = "npm run dependencies --if-present --workspaces";

/** Run npm, returning everything it printed — nudeps writes to both stdout and stderr. */
function npm (args, cwd) {
	let { status, stdout, stderr } = spawnSync("npm", [...args, "--foreground-scripts"], {
		cwd,
		encoding: "utf8",
		env: { ...process.env, npm_config_audit: "false", npm_config_fund: "false" },
	});

	if (status !== 0) {
		throw new Error(stderr || stdout);
	}

	return stdout + stderr;
}

let pkg = (dir, data) => writeFileSync(join(dir, "package.json"), JSON.stringify(data));

/** A local package to install, so no test needs the registry. */
function dependency (base, name) {
	let dir = join(base, name);
	mkdirSync(dir, { recursive: true });
	pkg(dir, { name, version: "1.0.0", type: "module", exports: "./index.js" });
	writeFileSync(join(dir, "index.js"), `export default ${JSON.stringify(name)};\n`);
	return dir;
}

/** The bare specifiers of a generated import map, so expectations read as package names. */
function specifiers (map) {
	if (!existsSync(map)) {
		return null;
	}

	let json = readFileSync(map, "utf8").match(/let map = ({[\s\S]*?\n});/)?.[1];
	return Object.keys(JSON.parse(json ?? "{}").imports ?? {});
}

/**
 * A workspace root with one child, installed once — the state every test below starts from.
 * @param {object} [options]
 * @param {boolean} [options.rootHook] - Whether the root delegates `dependencies` to its children.
 * @param {string} [options.childHook] - The command the child's own hooks run.
 */
function workspace ({ rootHook = true, childHook = CLI } = {}) {
	let base = mkdtempSync(join(tmpdir(), "nudeps-lifecycle-"));
	let root = join(base, "root");
	let child = join(root, "packages", "app");
	mkdirSync(child, { recursive: true });

	pkg(root, {
		name: "root",
		private: true,
		workspaces: ["packages/*"],
		scripts: rootHook ? { dependencies: DELEGATE } : {},
	});
	pkg(child, {
		name: "app",
		version: "1.0.0",
		type: "module",
		scripts: { dependencies: childHook, prepare: childHook },
	});

	return {
		base,
		root,
		child,
		map: join(child, "importmap.js"),
		dep: dependency(base, "dep"),
	};
}

const workspaceChild = {
	name: "Workspace child",
	description:
		"npm rewrites the root lockfile after running a child's `prepare`, and fires `dependencies` on the root only — so the child's own run must stand aside for it (#171), unless there is no such hook to stand aside for (#172).",
	beforeEach (options) {
		Object.assign(this.data, { ws: workspace(options) });
		npm(["install"], this.data.ws.root);
	},
	afterEach () {
		rmSync(this.data.ws.base, { recursive: true, force: true });
	},
	tests: [
		{
			name: "The child's own run during an install is skipped",
			run () {
				let { child, dep } = this.data.ws;
				return npm(["install", dep], child).includes(SKIP);
			},
			expect: true,
		},
		{
			name: "The root's hook regenerates the map from the new lockfile",
			run () {
				let { child, dep, map } = this.data.ws;
				npm(["install", dep], child);
				return specifiers(map);
			},
			expect: ["dep"],
		},
		{
			name: "A root without the hook is warned about",
			arg: { rootHook: false },
			run () {
				let { child, dep } = this.data.ws;
				return npm(["install", dep], child).includes(WARNING);
			},
			expect: true,
		},
		{
			name: "`npm pack` runs against a current lockfile, so it is not skipped",
			description: "It is the run that puts the import map in the published tarball.",
			run () {
				let { root, child, dep, map } = this.data.ws;
				npm(["install", dep], child);
				rmSync(map);

				return {
					skipped: npm(["pack", "--workspace", "app"], root).includes(SKIP),
					map: specifiers(map),
				};
			},
			expect: { skipped: false, map: ["dep"] },
		},
		{
			name: "`npm prune` is not skipped, since no hook follows it",
			description:
				"Unlike install/ci/uninstall/link, npm fires no `dependencies` hook afterwards, so skipping would strand the map.",
			run () {
				let { child, dep, map } = this.data.ws;
				npm(["install", dep], child);
				pkg(child, {
					name: "app",
					version: "1.0.0",
					type: "module",
					scripts: { dependencies: CLI, prepare: CLI },
				});

				npm(["prune"], child);
				return specifiers(map);
			},
			expect: [],
		},
		{
			name: "A run with no lockfile to resolve against stands aside",
			description:
				"npm writes the root's lockfile during this very install. For an `npx`-wrapped hook, whose `npm_command` is `exec`, its absence is the only signal left — without it the hook aborts the root's install (#171).",
			arg: { childHook: WRAPPED },
			// The root's install is the subject here, so it runs in the test: an abort must fail it,
			// and a `beforeEach` that throws would only skip.
			beforeEach (options) {
				Object.assign(this.data, { ws: workspace(options) });
			},
			run () {
				return npm(["install"], this.data.ws.root).includes(SKIP);
			},
			expect: true,
		},
		{
			name: "…and runs once that lockfile exists",
			arg: { childHook: WRAPPED },
			run () {
				let { child, dep, map } = this.data.ws;
				npm(["install", dep], child);
				return specifiers(map);
			},
			expect: ["dep"],
		},
	],
};

const localDependency = {
	name: "Local dependency",
	description:
		"`npm install ../lib` runs lib's hooks with the consumer as npm's prefix, but lib resolves against its own lockfile and no root hook picks up the work — so it must neither stand aside nor be warned about (SKILL.md: Local Dependencies).",
	beforeEach () {
		let base = mkdtempSync(join(tmpdir(), "nudeps-local-dependency-"));
		let lib = join(base, "lib");
		mkdirSync(lib);
		pkg(lib, {
			name: "lib",
			version: "1.0.0",
			type: "module",
			scripts: { dependencies: CLI, prepare: CLI },
			dependencies: { dep: `file:${dependency(base, "dep")}` },
		});
		npm(["install"], lib);
		rmSync(join(lib, "importmap.js"));

		Object.assign(this.data, { base, lib, map: join(lib, "importmap.js") });
	},
	afterEach () {
		rmSync(this.data.base, { recursive: true, force: true });
	},
	tests: [
		{
			name: "Generates its map during a plain consumer's install",
			run () {
				let { base, lib, map } = this.data;
				let app = join(base, "app");
				mkdirSync(app);
				pkg(app, { name: "app", version: "1.0.0", type: "module" });

				return { skipped: npm(["install", lib], app).includes(SKIP), map: specifiers(map) };
			},
			expect: { skipped: false, map: ["dep"] },
		},
		{
			name: "Generates it from inside a workspace child too",
			description:
				"The root's `--workspaces` delegation never reaches a package outside the workspace, so neither the skip nor the missing-hook warning applies there.",
			run () {
				let { lib, map } = this.data;
				let ws = workspace({ rootHook: false, childHook: "" });
				npm(["install"], ws.root);

				try {
					let output = npm(["install", lib], ws.child);
					return {
						skipped: output.includes(SKIP),
						warned: output.includes(WARNING),
						map: specifiers(map),
					};
				}
				finally {
					rmSync(ws.base, { recursive: true, force: true });
				}
			},
			expect: { skipped: false, warned: false, map: ["dep"] },
		},
	],
};

export default {
	name: "npm lifecycle",
	tests: [workspaceChild, localDependency],
};
