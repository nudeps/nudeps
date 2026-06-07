import Packages from "../../src/util/packages.js";

// Default lockfile with explicit entries for packages used in tests
let v = { version: "1.2.3" };
let defaultData = {
	packages: {
		"node_modules/foo": v,
		"node_modules/@foo/bar": v,
		"node_modules/foo/node_modules/bar": v,
		"node_modules/foo/node_modules/@bar/baz": v,
		"node_modules/@foo/bar/node_modules/@baz/quux": v,
	},
};
let defaultPackages = new Packages(defaultData);

// Case A: transitive dep via local dep's resolved path (../vue → nudeps-demo-vue)
let caseAPackages = new Packages(
	{
		packages: {
			"node_modules/nudeps-demo-vue": { link: true, resolved: "../vue" },
			"../vue": {
				version: "0.0.1",
				name: "nudeps-demo-vue",
				devDependencies: { nudeps: "latest" },
			},
		},
	},
	{
		children: {
			"../vue": { packages: { "node_modules/vue": { version: "3.5.26", name: "vue" } } },
		},
	},
);

// Case A with reuse: main lockfile also has vue@3.5.26
let caseAReusePackages = new Packages(
	{
		packages: {
			"node_modules/nudeps-demo-vue": { link: true, resolved: "../vue" },
			"../vue": {
				version: "0.0.1",
				name: "nudeps-demo-vue",
				devDependencies: { nudeps: "latest" },
			},
			"node_modules/vue": { version: "3.5.26", name: "vue" },
		},
	},
	{
		children: {
			"../vue": { packages: { "node_modules/vue": { version: "3.5.26", name: "vue" } } },
		},
	},
);

// Case B: nested under an external (linked) package
let caseBPackages = new Packages(
	{
		packages: {
			"node_modules/ext-pkg": { link: true, resolved: "../ext" },
			"../ext": { version: "1.0.0", name: "ext-pkg", devDependencies: { nudeps: "latest" } },
		},
	},
	{
		children: {
			"../ext": { packages: { "node_modules/dep": { version: "2.0.0", name: "dep" } } },
		},
	},
);

// Case C: npm workspace root lockfile (from a real `npm install`). Workspace packages appear
// as a link entry plus a real on-disk entry; regular deps (leftpad) are hoisted to the root.
let workspacePackages = new Packages({
	packages: {
		"node_modules/@demo/pkg-a": { link: true, resolved: "packages/pkg-a" },
		"node_modules/@demo/pkg-b": { link: true, resolved: "packages/pkg-b" },
		"node_modules/leftpad": { version: "0.0.1", name: "leftpad" },
		"packages/pkg-a": {
			name: "@demo/pkg-a",
			version: "1.0.0",
			dependencies: { "@demo/pkg-b": "1.0.0", leftpad: "0.0.1" },
		},
		"packages/pkg-b": { name: "@demo/pkg-b", version: "1.0.0" },
	},
});

// Case D: same lockfile read from inside a package (prefix "../.."), so paths rebase to cwd
// while keys still match the generator's "../../node_modules/..." URLs.
let workspacePrefixPackages = new Packages(
	{
		packages: {
			"node_modules/@demo/pkg-a": { link: true, resolved: "packages/pkg-a" },
			"node_modules/leftpad": { version: "0.0.1", name: "leftpad" },
			"packages/pkg-a": {
				name: "@demo/pkg-a",
				version: "1.0.0",
				dependencies: { leftpad: "0.0.1" },
			},
		},
	},
	{ prefix: "../.." },
);

// Case E: workspace prefix + external linked dep with children.
let workspaceExternalPackages = new Packages(
	{
		packages: {
			"node_modules/ext-pkg": { link: true, resolved: "../ext" },
			"../ext": { version: "1.0.0", name: "ext-pkg", devDependencies: { nudeps: "latest" } },
		},
	},
	{
		prefix: "../..",
		children: {
			"../../../ext": { packages: { "node_modules/dep": { version: "2.0.0", name: "dep" } } },
		},
	},
);

// Case F: workspace prefix + non-hoisted dep in the child's own node_modules.
let workspaceChildNodeModulesPackages = new Packages(
	{
		packages: {
			"node_modules/color-name": { version: "1.1.4", name: "color-name" },
			"packages/pkg-a/node_modules/color-name": { version: "2.1.0", name: "color-name" },
		},
	},
	{ prefix: "../.." },
);

// Chained links: two linked packages in series before a leaf dep.
// Models: app (link) → core (nested link) → util (regular dep)
// npm flattens intermediate links into the root lockfile with their resolved paths.
let chainedLinksPackages = new Packages(
	{
		packages: {
			"node_modules/app": { link: true, resolved: "../app" },
			"../app": { version: "3.0.0", name: "app", dependencies: { "@ns/core": "^3" } },
			"../app/node_modules/@ns/core": { link: true, resolved: "../core" },
			"../core": { version: "3.0.0", name: "@ns/core", dependencies: { "util-lib": "^0.1" } },
		},
	},
	{
		children: {
			"../core": {
				packages: { "node_modules/util-lib": { version: "0.1.5", name: "util-lib" } },
			},
		},
	},
);

// Case G: npm-linked to global store, no child lockfile.
// Transitive dep is hoisted in the root lockfile only.
let globalLinkedPackages = new Packages({
	packages: {
		"node_modules/@ns/core": { link: true, resolved: "../../.nvm/lib/node_modules/@ns/core" },
		"../../.nvm/lib/node_modules/@ns/core": {
			version: "3.0.0",
			name: "@ns/core",
			dependencies: { hooks: "^0.0" },
		},
		"node_modules/hooks": { version: "0.0.2", name: "hooks" },
	},
});

// Case G variant: same as G, but the hoisted transitive dep is also npm-linked.
let globalLinkedBothPackages = new Packages({
	packages: {
		"node_modules/@ns/core": { link: true, resolved: "../../.nvm/lib/node_modules/@ns/core" },
		"../../.nvm/lib/node_modules/@ns/core": {
			version: "3.0.0",
			name: "@ns/core",
			dependencies: { hooks: "^0.0" },
		},
		"node_modules/hooks": { link: true, resolved: "../../.nvm/lib/node_modules/hooks" },
		"../../.nvm/lib/node_modules/hooks": { version: "0.0.2", name: "hooks" },
	},
});

// Case H: linked package whose child lockfile contains link entries and
// grandchild lockfiles. Tests child link resolution (link entries carry no
// name/version) and recursive child lockfile loading (2+ levels deep).
let childLinkedDepsPackages = new Packages(
	{
		packages: {
			"node_modules/framework": { link: true, resolved: "../framework" },
			"../framework": {
				version: "3.0.0",
				name: "framework",
				dependencies: { "@scope/core": "^3", "plain-dep": "^1" },
			},
			"node_modules/@scope/core": { link: true, resolved: "../@scope/core" },
			"../@scope/core": { version: "3.0.0", name: "@scope/core" },
		},
	},
	{
		children: {
			"../framework": {
				packages: {
					"node_modules/@scope/core": { link: true, resolved: "../core" },
					"../core": {
						version: "3.0.0",
						name: "@scope/core",
						dependencies: { "leaf-dep": "^1" },
					},
					"node_modules/plain-dep": { link: true, resolved: "../plain-dep" },
					"../plain-dep": { version: "1.2.0", name: "plain-dep" },
				},
			},
			"../core": {
				packages: {
					"node_modules/leaf-dep": { version: "1.0.0", name: "leaf-dep" },
				},
			},
		},
	},
);

// Case I: dev-only entries (dev: true) in lockfiles should be filtered out
// to prevent devDependencies from leaking into the package index.
let childDevDepsPackages = new Packages(
	{
		packages: {
			"node_modules/ext-pkg": { link: true, resolved: "../ext" },
			"../ext": {
				version: "1.0.0",
				name: "ext-pkg",
				dependencies: { "prod-dep": "^1" },
				devDependencies: { "dev-dep": "^2" },
			},
		},
	},
	{
		children: {
			"../ext": {
				packages: {
					"node_modules/prod-dep": { version: "1.0.0", name: "prod-dep" },
					"node_modules/dev-dep": { version: "2.0.0", name: "dev-dep", dev: true },
				},
			},
		},
	},
);

let dir = "./client_modules";

/**
 * Mirrors Nudeps.localDir for testing without the full Nudeps class.
 */
function localDir (pkg) {
	if (!pkg?.name) return dir;
	return [dir, pkg.dirName].join("/");
}

export default {
	run (prop) {
		let url = this.parent.name;
		let packages = this.parent.packages ?? defaultPackages;
		let { pkg, filePath, sourcePath } = packages.parse(url);

		switch (prop) {
			case "filePath":
				return filePath;
			case "sourcePath":
				return sourcePath;
			case "path":
				return pkg?.path;
			case "resolvedPath":
				return pkg?.resolvedPath;
			case "pkg":
				return pkg;
			case "name":
				return pkg?.name;
			case "version":
				return pkg?.version;
			case "installName":
				return pkg?.installName;
			case "isExternal":
				return pkg?.isExternal ?? false;
			case "isNested":
				return !!pkg?.parent;
			case "localDir":
				return localDir(pkg);
			case "localPath":
				return [localDir(pkg), filePath].join("/");
			case "dirName":
				return pkg?.dirName;
			case "parentName":
				return pkg?.parent?.name;
		}
	},
	tests: [
		{
			name: "./node_modules/foo/bar/index.js",
			tests: [
				{ arg: "name", expect: "foo" },
				{ arg: "version", expect: "1.2.3" },
				{ arg: "isNested", expect: false },
				{ arg: "filePath", expect: "bar/index.js" },
				{ arg: "localDir", expect: "./client_modules/foo@1.2.3" },
				{ arg: "sourcePath", expect: "./node_modules/foo" },
			],
		},
		{
			name: "./node_modules/@foo/bar/index.js",
			tests: [
				{ arg: "name", expect: "@foo/bar" },
				{ arg: "version", expect: "1.2.3" },
				{ arg: "isNested", expect: false },
				{ arg: "installName", expect: "@foo/bar" },
			],
		},
		{
			name: "./node_modules/foo/node_modules/bar/index.js",
			tests: [
				{ arg: "isNested", expect: true },
				{ arg: "name", expect: "bar" },
				{ arg: "localDir", expect: "./client_modules/bar@1.2.3" },
				{ arg: "parentName", expect: "foo" },
			],
		},
		{
			name: "./node_modules/foo/node_modules/@bar/baz/index.js",
			tests: [
				{ arg: "isNested", expect: true },
				{ arg: "localDir", expect: "./client_modules/@bar/baz@1.2.3" },
				{ arg: "sourcePath", expect: "./node_modules/foo/node_modules/@bar/baz" },
			],
		},
		{
			name: "./node_modules/@foo/bar/node_modules/@baz/quux/index.js",
			tests: [
				{ arg: "isNested", expect: true },
				{ arg: "localDir", expect: "./client_modules/@baz/quux@1.2.3" },
				{ arg: "name", expect: "@baz/quux" },
				{ arg: "version", expect: "1.2.3" },
				{ arg: "sourcePath", expect: "./node_modules/@foo/bar/node_modules/@baz/quux" },
			],
		},
		{
			name: "./node_modules/@floating-ui/",
			description: "Scope-only directory with trailing slash",
			tests: [
				{ arg: "pkg", expect: null },
				{ arg: "filePath", expect: "@floating-ui/" },
				{ arg: "localDir", expect: "./client_modules" },
				{ arg: "localPath", expect: "./client_modules/@floating-ui/" },
			],
		},
		{
			name: "./node_modules/@foo",
			description: "Scope-only directory without trailing slash",
			tests: [
				{ arg: "pkg", expect: null },
				{ arg: "filePath", expect: "@foo" },
				{ arg: "localDir", expect: "./client_modules" },
				{ arg: "localPath", expect: "./client_modules/@foo" },
			],
		},
		{
			name: "./node_modules/@foo/bar/",
			description: "Scoped package with trailing slash (directory mapping)",
			tests: [
				{ arg: "name", expect: "@foo/bar" },
				{ arg: "filePath", expect: "" },
				{ arg: "localDir", expect: "./client_modules/@foo/bar@1.2.3" },
				{ arg: "localPath", expect: "./client_modules/@foo/bar@1.2.3/" },
			],
		},
		{
			name: "./node_modules/foo/",
			description: "Unscoped package with trailing slash (directory mapping)",
			tests: [
				{ arg: "name", expect: "foo" },
				{ arg: "filePath", expect: "" },
				{ arg: "localDir", expect: "./client_modules/foo@1.2.3" },
				{ arg: "localPath", expect: "./client_modules/foo@1.2.3/" },
			],
		},
		{
			name: "./node_modules/foo/node_modules/@bar/",
			description: "Nested scope-only directory",
			tests: [
				{ arg: "name", expect: "foo" },
				{ arg: "filePath", expect: "@bar/" },
				{ arg: "localPath", expect: "./client_modules/foo@1.2.3/@bar/" },
			],
		},
		// Case A: transitive dep via local dep's resolved path — flat top-level
		{
			name: "../vue/node_modules/vue/dist/vue.esm-bundler.js",
			packages: caseAPackages,
			tests: [
				{ arg: "version", expect: "3.5.26" },
				{ arg: "name", expect: "vue" },
				{ arg: "isExternal", expect: true },
				{ arg: "parentName", expect: "nudeps-demo-vue" },
				{ arg: "localDir", expect: "./client_modules/vue@3.5.26" },
				{ arg: "sourcePath", expect: "../vue/node_modules/vue" },
			],
		},
		// Case A with reuse: same flat path
		{
			name: "../vue/node_modules/vue/dist/vue.esm-bundler.js",
			packages: caseAReusePackages,
			tests: [{ arg: "localDir", expect: "./client_modules/vue@3.5.26" }],
		},
		// Case B: nested under external — flat top-level
		{
			name: "./node_modules/ext-pkg/node_modules/dep/index.js",
			packages: caseBPackages,
			tests: [
				{ arg: "version", expect: "2.0.0" },
				{ arg: "name", expect: "dep" },
				{ arg: "isExternal", expect: true },
				{ arg: "localDir", expect: "./client_modules/dep@2.0.0" },
				{ arg: "sourcePath", expect: "../ext/node_modules/dep" },
			],
		},
		// Case C: npm workspace package — symlinked into the root node_modules.
		// Resolves through the link to its on-disk entry and is treated as external/linked,
		// just like a `npm install ../foo` local dep.
		{
			name: "./node_modules/@demo/pkg-a/index.js",
			packages: workspacePackages,
			description: "npm workspace package, linked into root node_modules",
			tests: [
				{ arg: "name", expect: "@demo/pkg-a" },
				{ arg: "version", expect: "1.0.0" },
				{ arg: "isExternal", expect: true },
				{ arg: "localDir", expect: "./client_modules/@demo/pkg-a@1.0.0" },
				{ arg: "sourcePath", expect: "./node_modules/@demo/pkg-a" },
			],
		},
		// Case C: hoisted dependency of a workspace package — npm installs it at the root
		// node_modules/ rather than under the workspace package, so it is an ordinary,
		// non-external package as far as nudeps is concerned.
		{
			name: "./node_modules/leftpad/index.js",
			packages: workspacePackages,
			description: "Hoisted dependency of a workspace package",
			tests: [
				{ arg: "name", expect: "leftpad" },
				{ arg: "version", expect: "0.0.1" },
				{ arg: "isExternal", expect: false },
				{ arg: "localDir", expect: "./client_modules/leftpad@0.0.1" },
				{ arg: "sourcePath", expect: "./node_modules/leftpad" },
			],
		},
		// Case D: parsing the generator's "../../node_modules/..." URLs under prefix.
		{
			name: "../../node_modules/leftpad/index.js",
			packages: workspacePrefixPackages,
			description: "Hoisted dep resolved from inside a workspace package (prefix)",
			tests: [
				{ arg: "name", expect: "leftpad" },
				{ arg: "version", expect: "0.0.1" },
				{ arg: "isExternal", expect: false },
				{ arg: "path", expect: "../../node_modules/leftpad" },
				{ arg: "sourcePath", expect: "../../node_modules/leftpad" },
				{ arg: "localDir", expect: "./client_modules/leftpad@0.0.1" },
			],
		},
		{
			name: "../../node_modules/@demo/pkg-a/index.js",
			packages: workspacePrefixPackages,
			description: "Sibling workspace package resolved from inside a package (prefix)",
			tests: [
				{ arg: "name", expect: "@demo/pkg-a" },
				{ arg: "isExternal", expect: true },
				{ arg: "path", expect: "../../node_modules/@demo/pkg-a" },
				{ arg: "resolvedPath", expect: "../../packages/pkg-a" },
				{ arg: "sourcePath", expect: "../../node_modules/@demo/pkg-a" },
				{ arg: "localDir", expect: "./client_modules/@demo/pkg-a@1.0.0" },
			],
		},
		// Case E: transitive dep of external linked dep, with workspace prefix.
		{
			name: "../../../ext/node_modules/dep/index.js",
			packages: workspaceExternalPackages,
			description: "Transitive dep merged under prefix",
			tests: [
				{ arg: "name", expect: "dep" },
				{ arg: "version", expect: "2.0.0" },
			],
		},
		// Chained links: dep nested 2 levels deep through two linked packages.
		{
			name: "./node_modules/app/node_modules/@ns/core/node_modules/util-lib/src/index.js",
			description: "Chained links: dep nested 2 levels deep through two linked packages",
			packages: chainedLinksPackages,
			tests: [
				{ arg: "version", expect: "0.1.5" },
				{ arg: "name", expect: "util-lib" },
				{ arg: "isExternal", expect: true },
				{ arg: "localDir", expect: "./client_modules/util-lib@0.1.5" },
				{ arg: "sourcePath", expect: "../core/node_modules/util-lib" },
			],
		},
		// Case F: non-hoisted dep in workspace child's own node_modules.
		{
			name: "./node_modules/color-name/index.js",
			description:
				"Version conflict: npm installs v2.1.0 under packages/pkg-a/node_modules/ while v1.1.4 is hoisted. Should resolve to the child's version, not the hoisted one.",
			packages: workspaceChildNodeModulesPackages,
			tests: [
				{ arg: "name", expect: "color-name" },
				{ arg: "version", expect: "2.1.0" },
				{ arg: "path", expect: "../../packages/pkg-a/node_modules/color-name" },
				{ arg: "sourcePath", expect: "../../packages/pkg-a/node_modules/color-name" },
				{ arg: "localDir", expect: "./client_modules/color-name@2.1.0" },
			],
		},
		// Case G: npm-linked to global store, no child lockfile.
		{
			name: "./node_modules/@ns/core/node_modules/hooks/src/index.js",
			description:
				"Transitive dep hoisted in root lockfile, no child lockfile for linked package",
			packages: globalLinkedPackages,
			tests: [
				{ arg: "name", expect: "hooks" },
				{ arg: "version", expect: "0.0.2" },
				{ arg: "path", expect: "./node_modules/hooks" },
				{ arg: "sourcePath", expect: "./node_modules/hooks" },
				{ arg: "localDir", expect: "./client_modules/hooks@0.0.2" },
			],
		},
		// Case G variant: transitive dep is also npm-linked.
		{
			name: "./node_modules/@ns/core/node_modules/hooks/src/index.js",
			description: "Both the parent and the hoisted transitive dep are npm-linked",
			packages: globalLinkedBothPackages,
			tests: [
				{ arg: "name", expect: "hooks" },
				{ arg: "version", expect: "0.0.2" },
				{ arg: "isExternal", expect: true },
				{ arg: "path", expect: "./node_modules/hooks" },
				{ arg: "sourcePath", expect: "./node_modules/hooks" },
				{ arg: "localDir", expect: "./client_modules/hooks@0.0.2" },
			],
		},
		// Case H: child lockfile contains link entries (no name/version on the link).
		{
			name: "./node_modules/framework/node_modules/@scope/core/inspire.mjs",
			description: "Scoped child link entry resolved from its target",
			packages: childLinkedDepsPackages,
			tests: [
				{ arg: "name", expect: "@scope/core" },
				{ arg: "version", expect: "3.0.0" },
				{ arg: "localDir", expect: "./client_modules/@scope/core@3.0.0" },
				{ arg: "isExternal", expect: true },
				{ arg: "path", expect: "../framework/node_modules/@scope/core" },
				{ arg: "resolvedPath", expect: "../core" },
				{ arg: "sourcePath", expect: "../framework/node_modules/@scope/core" },
			],
		},
		// Case H: unscoped variant — same link resolution applies.
		{
			name: "./node_modules/framework/node_modules/plain-dep/index.js",
			description: "Unscoped child link entry resolved from its target",
			packages: childLinkedDepsPackages,
			tests: [
				{ arg: "name", expect: "plain-dep" },
				{ arg: "version", expect: "1.2.0" },
				{ arg: "localDir", expect: "./client_modules/plain-dep@1.2.0" },
				{ arg: "isExternal", expect: true },
				{ arg: "path", expect: "../framework/node_modules/plain-dep" },
				{ arg: "resolvedPath", expect: "../plain-dep" },
				{ arg: "sourcePath", expect: "../framework/node_modules/plain-dep" },
			],
		},
		// Case H: leaf dep from grandchild lockfile (2+ levels deep).
		{
			name: "./node_modules/framework/node_modules/@scope/core/node_modules/leaf-dep/index.js",
			description: "Leaf dep from a child link's own child lockfile",
			packages: childLinkedDepsPackages,
			tests: [
				{ arg: "name", expect: "leaf-dep" },
				{ arg: "version", expect: "1.0.0" },
				{ arg: "isExternal", expect: true },
				{ arg: "path", expect: "../core/node_modules/leaf-dep" },
				{ arg: "sourcePath", expect: "../core/node_modules/leaf-dep" },
				{ arg: "localDir", expect: "./client_modules/leaf-dep@1.0.0" },
			],
		},
		// Case I: dev-only entries in child lockfile should be filtered out.
		{
			name: "./node_modules/ext-pkg/node_modules/prod-dep/index.js",
			description: "Production dep from child lockfile is merged",
			packages: childDevDepsPackages,
			tests: [
				{ arg: "name", expect: "prod-dep" },
				{ arg: "version", expect: "1.0.0" },
			],
		},
		{
			name: "./node_modules/ext-pkg/node_modules/dev-dep/index.js",
			description: "Dev-only dep from child lockfile must not be merged",
			packages: childDevDepsPackages,
			tests: [{ arg: "pkg", expect: null }],
		},
	],
};
