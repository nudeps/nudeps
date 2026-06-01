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
let caseAPackages = new Packages({
	packages: {
		"node_modules/nudeps-demo-vue": { link: true, resolved: "../vue" },
		"../vue": { version: "0.0.1", name: "nudeps-demo-vue", devDependencies: { nudeps: "latest" } },
	},
}, {
	children: { "../vue": { packages: { "node_modules/vue": { version: "3.5.26", name: "vue" } } } },
});

// Case A with reuse: main lockfile also has vue@3.5.26
let caseAReusePackages = new Packages({
	packages: {
		"node_modules/nudeps-demo-vue": { link: true, resolved: "../vue" },
		"../vue": { version: "0.0.1", name: "nudeps-demo-vue", devDependencies: { nudeps: "latest" } },
		"node_modules/vue": { version: "3.5.26", name: "vue" },
	},
}, {
	children: { "../vue": { packages: { "node_modules/vue": { version: "3.5.26", name: "vue" } } } },
});

// Case B: nested under an external (linked) package
let caseBPackages = new Packages({
	packages: {
		"node_modules/ext-pkg": { link: true, resolved: "../ext" },
		"../ext": { version: "1.0.0", name: "ext-pkg", devDependencies: { nudeps: "latest" } },
	},
}, {
	children: { "../ext": { packages: { "node_modules/dep": { version: "2.0.0", name: "dep" } } } },
});

// Case C: npm workspaces. Shape captured from a real `npm install` of a workspace root:
// each workspace package appears twice — once as a link entry under node_modules/, and
// once as a real entry at its on-disk path — while regular deps are hoisted to the root
// node_modules/ (here `leftpad`, a dependency of pkg-a). Pins down that workspace packages
// resolve as external (linked) and hoisted deps resolve as ordinary, non-external packages.
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
			case "filePath": return filePath;
			case "sourcePath": return sourcePath;
			case "pkg": return pkg;
			case "name": return pkg?.name;
			case "version": return pkg?.version;
			case "installName": return pkg?.installName;
			case "isExternal": return pkg?.isExternal ?? false;
			case "isNested": return !!pkg?.parent;
			case "localDir": return localDir(pkg);
			case "localPath": return [localDir(pkg), filePath].join("/");
			case "dirName": return pkg?.dirName;
			case "parentName": return pkg?.parent?.name;
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
			tests: [
				{ arg: "localDir", expect: "./client_modules/vue@3.5.26" },
			],
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
	],
};
