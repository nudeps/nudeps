import Packages from "../../src/util/packages.js";
import { readJSONSync } from "../../src/util/fs.js";
import { writeFileSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

let tmpDir = path.join(path.dirname(fileURLToPath(import.meta.url)), ".tmp-client-deps");
let testId = 0;

// Write a synthetic project to disk that mirrors exactly what `Packages.load()` will read.
// `fs` keys are paths relative to `dir`; values are JSON written verbatim (so `.package-lock.json`
// gets `{ packages: {...} }` directly, and a package's manifest sits at `<pkg>/package.json`).
// `symlinks` keys are link locations; values are link targets (relative paths, as npm writes them).
function setupFixture (dir, { fs = {}, symlinks = {} } = {}) {
	rmSync(dir, { recursive: true, force: true });
	for (let [relPath, content] of Object.entries(fs)) {
		let abs = path.join(dir, relPath);
		mkdirSync(path.dirname(abs), { recursive: true });
		writeFileSync(abs, JSON.stringify(content));
	}
	for (let [linkPath, target] of Object.entries(symlinks)) {
		let abs = path.join(dir, linkPath);
		mkdirSync(path.dirname(abs), { recursive: true });
		symlinkSync(target, abs, "dir");
	}
}

// Mirror production's flow: nudeps reads ./package.json then calls Packages.load(cwd, { pkg }).
function loadPackages (dir, opts = {}) {
	return Packages.load(dir, { pkg: readJSONSync(path.join(dir, "package.json")), ...opts });
}

export default {
	name: "Packages.load() clientDependencies",
	beforeEach ({ fs, symlinks }) {
		let dir = path.join(tmpDir, `test-${++testId}`);
		this.data.dir = dir;
		setupFixture(dir, { fs, symlinks });
	},
	afterEach () {
		rmSync(this.data.dir, { recursive: true, force: true });
	},
	afterAll () {
		rmSync(tmpDir, { recursive: true, force: true });
	},
	tests: [
		{
			name: "Declared client dependency is promoted",
			arg: {
				fs: {
					"package.json": { devDependencies: { "site-builder": "^1.0.0" } },
					"node_modules/.package-lock.json": {
						packages: {
							"node_modules/site-builder": {
								dev: true,
								dependencies: { "widget-lib": "^1.0.0" },
							},
							"node_modules/widget-lib": { dev: true },
						},
					},
					"node_modules/site-builder/package.json": {
						name: "site-builder",
						version: "1.0.0",
						dependencies: { "widget-lib": "^1.0.0" },
						clientDependencies: ["widget-lib"],
					},
				},
			},
			run () {
				return loadPackages(this.data.dir).has("widget-lib");
			},
			expect: true,
		},
		{
			name: "Declaring tool itself is not promoted",
			arg: {
				fs: {
					"package.json": { devDependencies: { "site-builder": "^1.0.0" } },
					"node_modules/.package-lock.json": {
						packages: {
							"node_modules/site-builder": {
								dev: true,
								dependencies: { "widget-lib": "^1.0.0" },
							},
							"node_modules/widget-lib": { dev: true },
						},
					},
					"node_modules/site-builder/package.json": {
						name: "site-builder",
						version: "1.0.0",
						dependencies: { "widget-lib": "^1.0.0" },
						clientDependencies: ["widget-lib"],
					},
				},
			},
			run () {
				return loadPackages(this.data.dir).has("site-builder");
			},
			expect: false,
		},
		{
			name: "Tool's non-client dependencies stay dev",
			arg: {
				fs: {
					"package.json": { devDependencies: { "site-builder": "^1.0.0" } },
					"node_modules/.package-lock.json": {
						packages: {
							"node_modules/site-builder": {
								dev: true,
								dependencies: { "widget-lib": "^1.0.0", esbuild: "^1.0.0" },
							},
							"node_modules/widget-lib": { dev: true },
							"node_modules/esbuild": { dev: true },
						},
					},
					"node_modules/site-builder/package.json": {
						name: "site-builder",
						version: "1.0.0",
						dependencies: { "widget-lib": "^1.0.0", esbuild: "^1.0.0" },
						clientDependencies: ["widget-lib"],
					},
				},
			},
			run () {
				return loadPackages(this.data.dir).has("esbuild");
			},
			expect: false,
		},
		{
			name: "Promoted dependency's own dependencies follow",
			arg: {
				fs: {
					"package.json": { devDependencies: { "site-builder": "^1.0.0" } },
					"node_modules/.package-lock.json": {
						packages: {
							"node_modules/site-builder": {
								dev: true,
								dependencies: { "widget-lib": "^1.0.0" },
							},
							"node_modules/widget-lib": {
								dev: true,
								dependencies: { "widget-core": "^1.0.0" },
							},
							"node_modules/widget-core": { dev: true },
						},
					},
					"node_modules/site-builder/package.json": {
						name: "site-builder",
						version: "1.0.0",
						dependencies: { "widget-lib": "^1.0.0" },
						clientDependencies: ["widget-lib"],
					},
				},
			},
			run () {
				return loadPackages(this.data.dir).has("widget-core");
			},
			expect: true,
		},
		{
			name: "Aliased client dependency is promoted",
			description:
				"npm install aliases key the lockfile by the alias (`node_modules/<alias>`); the underlying package's real name sits on the `name` field. BFS matches by key, not by `name`.",
			arg: {
				fs: {
					"package.json": { devDependencies: { "alias-tool": "^1.0.0" } },
					"node_modules/.package-lock.json": {
						packages: {
							"node_modules/alias-tool": {
								dev: true,
								dependencies: { "alias-aliased": "npm:alias-actual@^1.0.0" },
							},
							"node_modules/alias-aliased": {
								name: "alias-actual",
								version: "1.0.0",
								dev: true,
							},
						},
					},
					"node_modules/alias-tool/package.json": {
						name: "alias-tool",
						version: "1.0.0",
						dependencies: { "alias-aliased": "npm:alias-actual@^1.0.0" },
						clientDependencies: ["alias-aliased"],
					},
				},
			},
			run () {
				return loadPackages(this.data.dir).has("alias-aliased");
			},
			expect: true,
		},
		{
			name: "Declaration chain is followed",
			arg: {
				fs: {
					"package.json": { devDependencies: { "build-tool": "^1.0.0" } },
					"node_modules/.package-lock.json": {
						packages: {
							"node_modules/build-tool": {
								dev: true,
								dependencies: { widget: "^1.0.0" },
							},
							"node_modules/widget": {
								dev: true,
								dependencies: { polyfill: "^1.0.0" },
							},
							"node_modules/polyfill": { dev: true },
						},
					},
					"node_modules/build-tool/package.json": {
						name: "build-tool",
						version: "1.0.0",
						dependencies: { widget: "^1.0.0" },
						clientDependencies: ["widget"],
					},
					"node_modules/widget/package.json": {
						name: "widget",
						version: "1.0.0",
						dependencies: { polyfill: "^1.0.0" },
						clientDependencies: ["polyfill"],
					},
				},
			},
			run () {
				return loadPackages(this.data.dir).has("polyfill");
			},
			expect: true,
		},
		{
			name: "Nested copy and its dependencies are promoted",
			description:
				"my-site pins widget@2 (hoisted) so npm nests build-tool's widget@1; checking `inner` discriminates because only the nested copy brings it.",
			arg: {
				fs: {
					"package.json": { devDependencies: { "build-tool": "^1.0.0" } },
					"node_modules/.package-lock.json": {
						packages: {
							"node_modules/widget": { version: "2.0.0" },
							"node_modules/build-tool": {
								dev: true,
								dependencies: { widget: "^1.0.0" },
							},
							"node_modules/build-tool/node_modules/widget": {
								version: "1.0.0",
								dev: true,
								dependencies: { inner: "^1.0.0" },
							},
							"node_modules/build-tool/node_modules/inner": { dev: true },
						},
					},
					"node_modules/build-tool/package.json": {
						name: "build-tool",
						version: "1.0.0",
						dependencies: { widget: "^1.0.0" },
						clientDependencies: ["widget"],
					},
				},
			},
			run () {
				return loadPackages(this.data.dir).has("inner");
			},
			expect: true,
		},
		{
			name: "Linked (symlinked) declaring package",
			description:
				"widget-lib is non-dev in the child lockfile regardless of the feature, so `has()` can't discriminate — assert on the promoted Set instead.",
			arg: {
				fs: {
					"package.json": { devDependencies: { "linked-builder": "^1.0.0" } },
					"node_modules/.package-lock.json": {
						packages: {
							"node_modules/linked-builder": {
								link: true,
								resolved: "linked-builder",
							},
							"linked-builder": { dev: true },
						},
					},
					"linked-builder/package.json": {
						name: "linked-builder",
						version: "1.0.0",
						dependencies: { "widget-lib": "^1.0.0" },
						clientDependencies: ["widget-lib"],
					},
					"linked-builder/node_modules/.package-lock.json": {
						packages: { "node_modules/widget-lib": {} },
					},
				},
				symlinks: {
					"node_modules/linked-builder": "../linked-builder",
				},
			},
			run () {
				return loadPackages(this.data.dir).clientDependencies.has("widget-lib");
			},
			expect: true,
		},
		{
			name: "Linked declarations chain through two symlink hops",
			description:
				"Chain: my-site → linked-builder → linked-widget → nested-target. nested-target is reachable only after both symlink hops resolve, so it discriminates.",
			arg: {
				fs: {
					"package.json": { devDependencies: { "linked-builder": "^1.0.0" } },
					"node_modules/.package-lock.json": {
						packages: {
							"node_modules/linked-builder": {
								link: true,
								resolved: "linked-builder",
							},
							"linked-builder": { dev: true },
						},
					},
					"linked-builder/package.json": {
						name: "linked-builder",
						version: "1.0.0",
						dependencies: { "linked-widget": "^1.0.0" },
						clientDependencies: ["linked-widget"],
					},
					"linked-builder/node_modules/.package-lock.json": {
						packages: {
							"node_modules/linked-widget": {
								link: true,
								resolved: "../linked-widget",
							},
						},
					},
					"linked-widget/package.json": {
						name: "linked-widget",
						version: "1.0.0",
						dependencies: { "nested-target": "^1.0.0" },
						clientDependencies: ["nested-target"],
					},
					"linked-widget/node_modules/.package-lock.json": {
						packages: { "node_modules/nested-target": {} },
					},
				},
				symlinks: {
					"node_modules/linked-builder": "../linked-builder",
					"linked-builder/node_modules/linked-widget": "../../linked-widget",
				},
			},
			run () {
				return loadPackages(this.data.dir).clientDependencies.has("nested-target");
			},
			expect: true,
		},
		{
			name: "ClientDependencies work from a workspace member",
			description:
				"Nudeps run from inside `packages/pkg-a`; lockfile lives at workspace root (prefix `../..`). Verifies findRoot walks to the workspace root, the BFS resolves paths against that root, and the dev-flip survives the prefix rebase.",
			arg: {
				fs: {
					"package.json": { workspaces: ["packages/*"] },
					"packages/pkg-a/package.json": {
						name: "@demo/pkg-a",
						version: "1.0.0",
						devDependencies: { "build-tool": "^1.0.0" },
					},
					"node_modules/.package-lock.json": {
						packages: {
							"node_modules/@demo/pkg-a": {
								link: true,
								resolved: "packages/pkg-a",
							},
							"packages/pkg-a": {
								name: "@demo/pkg-a",
								version: "1.0.0",
								devDependencies: { "build-tool": "^1.0.0" },
							},
							"node_modules/build-tool": {
								dev: true,
								dependencies: { "widget-lib": "^1.0.0" },
							},
							"node_modules/widget-lib": { dev: true },
						},
					},
					"node_modules/build-tool/package.json": {
						name: "build-tool",
						version: "1.0.0",
						dependencies: { "widget-lib": "^1.0.0" },
						clientDependencies: ["widget-lib"],
					},
				},
			},
			run () {
				return loadPackages(path.join(this.data.dir, "packages/pkg-a")).has("widget-lib");
			},
			expect: true,
		},
		// Open question on PR #133: should a bundled sub-tool's clientDependencies propagate
		// without the bundler re-declaring it? Both candidates marked `skip: "fail"` — exactly
		// one passes at a time, signaling which behavior is currently implemented.
		{
			name: "Sub-tool's clientDependencies are ignored (chain-from-seed)",
			skip: "fail",
			arg: {
				fs: {
					"package.json": { devDependencies: { bundler: "^1.0.0" } },
					"node_modules/.package-lock.json": {
						packages: {
							"node_modules/bundler": {
								dev: true,
								dependencies: { "sub-tool": "^1.0.0" },
							},
							"node_modules/sub-tool": {
								dev: true,
								dependencies: { "widget-lib": "^1.0.0" },
							},
							"node_modules/widget-lib": { dev: true },
						},
					},
					"node_modules/sub-tool/package.json": {
						name: "sub-tool",
						version: "1.0.0",
						dependencies: { "widget-lib": "^1.0.0" },
						clientDependencies: ["widget-lib"],
					},
				},
			},
			run () {
				return loadPackages(this.data.dir).has("widget-lib");
			},
			expect: false,
		},
		{
			name: "Sub-tool's clientDependencies propagate (full transitive)",
			skip: "fail",
			arg: {
				fs: {
					"package.json": { devDependencies: { bundler: "^1.0.0" } },
					"node_modules/.package-lock.json": {
						packages: {
							"node_modules/bundler": {
								dev: true,
								dependencies: { "sub-tool": "^1.0.0" },
							},
							"node_modules/sub-tool": {
								dev: true,
								dependencies: { "widget-lib": "^1.0.0" },
							},
							"node_modules/widget-lib": { dev: true },
						},
					},
					"node_modules/sub-tool/package.json": {
						name: "sub-tool",
						version: "1.0.0",
						dependencies: { "widget-lib": "^1.0.0" },
						clientDependencies: ["widget-lib"],
					},
				},
			},
			run () {
				return loadPackages(this.data.dir).has("widget-lib");
			},
			expect: true,
		},
		{
			name: "Consumer's devDependency overrides a tool's clientDependency",
			description:
				"Two observable outcomes: silent skip + actionable warn. One test per outcome, shared fixture cascaded via arg.",
			arg: {
				fs: {
					"package.json": {
						devDependencies: {
							"build-tool": "^1.0.0",
							"shared-lib": "^1.0.0",
						},
					},
					"node_modules/.package-lock.json": {
						packages: {
							"node_modules/build-tool": {
								dev: true,
								dependencies: { "shared-lib": "^1.0.0" },
							},
							"node_modules/shared-lib": { dev: true },
						},
					},
					"node_modules/build-tool/package.json": {
						name: "build-tool",
						version: "1.0.0",
						dependencies: { "shared-lib": "^1.0.0" },
						clientDependencies: ["shared-lib"],
					},
				},
			},
			tests: [
				{
					name: "Conflicting name stays dev",
					run () {
						return loadPackages(this.data.dir).has("shared-lib");
					},
					expect: false,
				},
				{
					name: "Warning names the conflict, the tool, and the fix",
					run () {
						let warnings = [];
						loadPackages(this.data.dir, { warn: m => warnings.push(m) });
						return warnings;
					},
					check: actual =>
						actual.some(
							w =>
								w.includes("'shared-lib'") &&
								w.includes("'build-tool'") &&
								w.includes("move 'shared-lib' to dependencies"),
						),
				},
			],
		},
	],
};
