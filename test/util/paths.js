import ModulePath from "../../src/util/path.js";

// Mock PackageLock that returns { version: "1.2.3" } for any node_modules/ key
let defaultPkgLock = {
	packages: new Proxy(
		{},
		{
			get (target, prop) {
				if (typeof prop === "string" && prop.startsWith("node_modules/")) {
					return { version: "1.2.3" };
				}
				return target[prop];
			},
		},
	),
	resolveKey (key) {
		return key;
	},
	isExternal () {
		return false;
	},
	findKeyByResolvedPath () {},
	external: {},
};

let defaultNudeps = {
	pkgLock: defaultPkgLock,
	dir: "./client_modules",
};

// Case A mock: transitive dep reached via local dep's resolved path (base = "../vue")
// Child lockfile entries are pre-merged with full-path keys
let caseAPkgLock = {
	packages: {
		"node_modules/nudeps-demo-vue": {
			version: "0.0.1",
			name: "nudeps-demo-vue",
			devDependencies: { nudeps: "latest" },
		},
		// Merged from child lockfile at ../vue
		"../vue/node_modules/vue": { version: "3.5.26", name: "vue" },
	},
	resolveKey (key) {
		return key;
	},
	isExternal () {
		return false;
	},
	findKeyByResolvedPath (path) {
		if (path === "../vue") return "node_modules/nudeps-demo-vue";
	},
	external: {},
};

let caseANudeps = {
	pkgLock: caseAPkgLock,
	dir: "./client_modules",
};

// Case A with reuse: main lockfile also has vue@3.5.26
let caseAReusePkgLock = {
	packages: {
		"node_modules/nudeps-demo-vue": {
			version: "0.0.1",
			name: "nudeps-demo-vue",
			devDependencies: { nudeps: "latest" },
		},
		"node_modules/vue": { version: "3.5.26", name: "vue" },
		"../vue/node_modules/vue": { version: "3.5.26", name: "vue" },
	},
	resolveKey (key) {
		return key;
	},
	isExternal () {
		return false;
	},
	findKeyByResolvedPath (path) {
		if (path === "../vue") return "node_modules/nudeps-demo-vue";
	},
	external: {},
};

let caseAReuseNudeps = {
	pkgLock: caseAReusePkgLock,
	dir: "./client_modules",
};

// Case B mock: nested under an external (linked) package
let caseBPkgLock = {
	packages: {
		"node_modules/ext-pkg": {
			version: "1.0.0",
			name: "ext-pkg",
			devDependencies: { nudeps: "latest" },
		},
		// Merged from child lockfile at ../ext
		"../ext/node_modules/dep": { version: "2.0.0", name: "dep" },
	},
	resolveKey (key) {
		if (key === "node_modules/ext-pkg") return "../ext";
		return key;
	},
	isExternal (key) {
		return key === "node_modules/ext-pkg";
	},
	findKeyByResolvedPath (path) {
		if (path === "../ext") return "node_modules/ext-pkg";
	},
	external: { "node_modules/ext-pkg": "../ext" },
};

let caseBNudeps = {
	pkgLock: caseBPkgLock,
	dir: "./client_modules",
};

// Case A unmanaged: external dep WITHOUT nudeps — child entries still merged
let caseAUnmanagedPkgLock = {
	packages: {
		"node_modules/nudeps-demo-vue": {
			version: "0.0.1",
			name: "nudeps-demo-vue",
		},
		"../vue/node_modules/vue": { version: "3.5.26", name: "vue" },
	},
	resolveKey (key) {
		return key;
	},
	isExternal () {
		return false;
	},
	findKeyByResolvedPath (path) {
		if (path === "../vue") return "node_modules/nudeps-demo-vue";
	},
	external: {},
};

let caseAUnmanagedNudeps = {
	pkgLock: caseAUnmanagedPkgLock,
	dir: "./client_modules",
};

// Case B unmanaged: external dep WITHOUT nudeps
let caseBUnmanagedPkgLock = {
	packages: {
		"node_modules/ext-pkg": { version: "1.0.0", name: "ext-pkg" },
		"../ext/node_modules/dep": { version: "2.0.0", name: "dep" },
	},
	resolveKey (key) {
		if (key === "node_modules/ext-pkg") return "../ext";
		return key;
	},
	isExternal (key) {
		return key === "node_modules/ext-pkg";
	},
	findKeyByResolvedPath (path) {
		if (path === "../ext") return "node_modules/ext-pkg";
	},
	external: { "node_modules/ext-pkg": "../ext" },
};

let caseBUnmanagedNudeps = {
	pkgLock: caseBUnmanagedPkgLock,
	dir: "./client_modules",
};

export default {
	run (prop) {
		let path = this.parent.name;
		let nudeps = this.parent.nudeps ?? defaultNudeps;
		// Clear cache to avoid cross-contamination between test groups
		ModulePath.all = {};
		return new ModulePath(path, nudeps)[prop];
	},
	tests: [
		{
			name: "./node_modules/foo/bar/index.js",
			tests: [
				{ arg: "base", expect: "." },
				{ arg: "isNested", expect: false },
				{ arg: "lockKey", expect: "node_modules/foo" },
				{ arg: "topLockKey", expect: "node_modules/foo" },
				{ arg: "version", expect: "1.2.3" },
				{ arg: "packageName", expect: "foo" },
				{ arg: "localDir", expect: "./client_modules/foo@1.2.3" },
				{ arg: "nodeDir", expect: "./node_modules/foo" },
				{ arg: "topNodeDir", expect: "./node_modules/foo" },
			],
		},
		{
			name: "./node_modules/@foo/bar/index.js",
			tests: [
				{ arg: "base", expect: "." },
				{ arg: "isNested", expect: false },
				{ arg: "lockKey", expect: "node_modules/@foo/bar" },
				{ arg: "topLockKey", expect: "node_modules/@foo/bar" },
				{ arg: "version", expect: "1.2.3" },
				{ arg: "packageName", expect: "@foo/bar" },
			],
		},
		{
			name: "./node_modules/foo/node_modules/bar/index.js",
			tests: [
				{ arg: "isNested", expect: true },
				{ arg: "lockKey", expect: "node_modules/foo/node_modules/bar" },
				{ arg: "topLockKey", expect: "node_modules/foo" },
				{ arg: "packageName", expect: "bar" },
				{ arg: "localDir", expect: "./client_modules/bar@1.2.3" },
			],
		},
		{
			name: "./node_modules/foo/node_modules/@bar/baz/index.js",
			tests: [
				{ arg: "isNested", expect: true },
				{ arg: "localDir", expect: "./client_modules/@bar/baz@1.2.3" },
				{ arg: "nodeDir", expect: "./node_modules/foo/node_modules/@bar/baz" },
				{ arg: "lockKey", expect: "node_modules/foo/node_modules/@bar/baz" },
				{ arg: "topLockKey", expect: "node_modules/foo" },
				{ arg: "topNodeDir", expect: "./node_modules/foo" },
			],
		},
		{
			name: "./node_modules/@foo/bar/node_modules/@baz/quux/index.js",
			tests: [
				{ arg: "isNested", expect: true },
				{ arg: "localDir", expect: "./client_modules/@baz/quux@1.2.3" },
				{ arg: "nodeDir", expect: "./node_modules/@foo/bar/node_modules/@baz/quux" },
				{ arg: "lockKey", expect: "node_modules/@foo/bar/node_modules/@baz/quux" },
				{ arg: "topLockKey", expect: "node_modules/@foo/bar" },
				{ arg: "topNodeDir", expect: "./node_modules/@foo/bar" },
				{ arg: "packageName", expect: "@baz/quux" },
				{ arg: "version", expect: "1.2.3" },
			],
		},
		{
			name: "./node_modules/@floating-ui/",
			description: "Scope-only directory with trailing slash",
			tests: [
				{ arg: "packages", expect: [] },
				{ arg: "filePath", expect: "@floating-ui/" },
				{ arg: "localDir", expect: "./client_modules" },
				{ arg: "localPath", expect: "./client_modules/@floating-ui/" },
			],
		},
		{
			name: "./node_modules/@foo",
			description: "Scope-only directory without trailing slash",
			tests: [
				{ arg: "packages", expect: [] },
				{ arg: "filePath", expect: "@foo" },
				{ arg: "localDir", expect: "./client_modules" },
				{ arg: "localPath", expect: "./client_modules/@foo" },
			],
		},
		{
			name: "./node_modules/@foo/bar/",
			description: "Scoped package with trailing slash (directory mapping)",
			tests: [
				{ arg: "packages", expect: ["@foo/bar"] },
				{ arg: "filePath", expect: "" },
				{ arg: "packageName", expect: "@foo/bar" },
				{ arg: "localDir", expect: "./client_modules/@foo/bar@1.2.3" },
				{ arg: "localPath", expect: "./client_modules/@foo/bar@1.2.3/" },
			],
		},
		{
			name: "./node_modules/foo/",
			description: "Unscoped package with trailing slash (directory mapping)",
			tests: [
				{ arg: "packages", expect: ["foo"] },
				{ arg: "filePath", expect: "" },
				{ arg: "packageName", expect: "foo" },
				{ arg: "localDir", expect: "./client_modules/foo@1.2.3" },
				{ arg: "localPath", expect: "./client_modules/foo@1.2.3/" },
			],
		},
		{
			name: "./node_modules/foo/node_modules/@bar/",
			description: "Nested scope-only directory",
			tests: [
				{ arg: "packages", expect: ["foo"] },
				{ arg: "filePath", expect: "@bar/" },
				{ arg: "packageName", expect: "foo" },
				{ arg: "localPath", expect: "./client_modules/foo@1.2.3/@bar/" },
			],
		},
		// Case A: transitive dep via local dep's resolved path — now flat (top-level)
		{
			name: "../vue/node_modules/vue/dist/vue.esm-bundler.js",
			nudeps: caseANudeps,
			tests: [
				{ arg: "externalBase", expect: "../vue" },
				{ arg: "version", expect: "3.5.26" },
				{ arg: "packageName", expect: "vue" },
				{ arg: "localDir", expect: "./client_modules/vue@3.5.26" },
			],
		},
		// Case A with reuse: main lockfile has the same package@version — same flat path
		{
			name: "../vue/node_modules/vue/dist/vue.esm-bundler.js",
			nudeps: caseAReuseNudeps,
			tests: [
				{ arg: "externalBase", expect: "../vue" },
				{ arg: "localDir", expect: "./client_modules/vue@3.5.26" },
			],
		},
		// Case B: nested under external (linked) package — now flat (top-level)
		{
			name: "./node_modules/ext-pkg/node_modules/dep/index.js",
			nudeps: caseBNudeps,
			tests: [
				{ arg: "externalBase", expect: "../ext" },
				{ arg: "version", expect: "2.0.0" },
				{ arg: "packageName", expect: "dep" },
				{ arg: "localDir", expect: "./client_modules/dep@2.0.0" },
			],
		},
		// Case A unmanaged: same flat path
		{
			name: "../vue/node_modules/vue/dist/vue.esm-bundler.js",
			nudeps: caseAUnmanagedNudeps,
			tests: [
				{ arg: "externalBase", expect: "../vue" },
				{ arg: "localDir", expect: "./client_modules/vue@3.5.26" },
			],
		},
		// Case B unmanaged: same flat path
		{
			name: "./node_modules/ext-pkg/node_modules/dep/index.js",
			nudeps: caseBUnmanagedNudeps,
			tests: [
				{ arg: "externalBase", expect: "../ext" },
				{ arg: "localDir", expect: "./client_modules/dep@2.0.0" },
			],
		},
	],
};
