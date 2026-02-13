import ModulePath from "../../src/util/path.js";

let mockNudeps = {
	dir: "./client_modules",
	packages: new Proxy(
		{
			// Simulate a file: protocol (linked) package in package-lock.json
			"node_modules/linked-pkg": { link: true, resolved: "../../some/path" },
			"../../some/path": { name: "linked-pkg", version: "4.5.6" },
		},
		{
			has (target, prop) {
				return prop.startsWith("node_modules/") || prop in target;
			},
			get (target, prop) {
				if (prop in target) {
					return target[prop];
				}
				if (prop.startsWith("node_modules/")) {
					return { version: "1.2.3" };
				}
			},
		},
	),
};

export default {
	run (prop) {
		let path = this.parent.name;

		return new ModulePath(path, mockNudeps)[prop];
	},
	tests: [
		{
			name: "./node_modules/foo/bar/index.js",
			tests: [
				{
					arg: "base",
					expect: ".",
				},
				{
					arg: "isNested",
					expect: false,
				},
				{
					arg: "lockKey",
					expect: "node_modules/foo",
				},
				{
					arg: "topLockKey",
					expect: "node_modules/foo",
				},
				{
					arg: "version",
					expect: "1.2.3",
				},
				{
					arg: "packageName",
					expect: "foo",
				},
				{
					arg: "localDir",
					expect: "./client_modules/foo@1.2.3",
				},
				{
					arg: "nodeDir",
					expect: "./node_modules/foo",
				},
				{
					arg: "topNodeDir",
					expect: "./node_modules/foo",
				},
			],
		},
		{
			name: "./node_modules/@foo/bar/index.js",
			tests: [
				{
					arg: "base",
					expect: ".",
				},
				{
					arg: "isNested",
					expect: false,
				},
				{
					arg: "lockKey",
					expect: "node_modules/@foo/bar",
				},
				{
					arg: "topLockKey",
					expect: "node_modules/@foo/bar",
				},
				{
					arg: "version",
					expect: "1.2.3",
				},
				{
					arg: "packageName",
					expect: "@foo/bar",
				},
			],
		},
		{
			name: "./node_modules/foo/node_modules/bar/index.js",
			tests: [
				{
					arg: "isNested",
					expect: true,
				},
				{
					arg: "lockKey",
					expect: "node_modules/foo/node_modules/bar",
				},
				{
					arg: "topLockKey",
					expect: "node_modules/foo",
				},
				{
					arg: "packageName",
					expect: "bar",
				},
				{
					arg: "localDir",
					expect: "./client_modules/bar@1.2.3",
				},
			],
		},
		{
			name: "./node_modules/foo/node_modules/@bar/baz/index.js",
			tests: [
				{
					arg: "isNested",
					expect: true,
				},
				{
					arg: "localDir",
					expect: "./client_modules/@bar/baz@1.2.3",
				},
				{
					arg: "nodeDir",
					expect: "./node_modules/foo/node_modules/@bar/baz",
				},
				{
					arg: "lockKey",
					expect: "node_modules/foo/node_modules/@bar/baz",
				},
				{
					arg: "topLockKey",
					expect: "node_modules/foo",
				},
				{
					arg: "topNodeDir",
					expect: "./node_modules/foo",
				},
			],
		},
		{
			name: "./node_modules/linked-pkg/dist/index.js",
			tests: [
				{
					arg: "version",
					expect: "4.5.6",
				},
				{
					arg: "packageName",
					expect: "linked-pkg",
				},
				{
					arg: "localDir",
					expect: "./client_modules/linked-pkg@4.5.6",
				},
			],
		},
		{
			name: "./node_modules/@foo/bar/node_modules/@baz/quux/index.js",
			tests: [
				{
					arg: "isNested",
					expect: true,
				},
				{
					arg: "localDir",
					expect: "./client_modules/@baz/quux@1.2.3",
				},
				{
					arg: "nodeDir",
					expect: "./node_modules/@foo/bar/node_modules/@baz/quux",
				},
				{
					arg: "lockKey",
					expect: "node_modules/@foo/bar/node_modules/@baz/quux",
				},
				{
					arg: "topLockKey",
					expect: "node_modules/@foo/bar",
				},
				{
					arg: "topNodeDir",
					expect: "./node_modules/@foo/bar",
				},
				{
					arg: "packageName",
					expect: "@baz/quux",
				},
				{
					arg: "version",
					expect: "1.2.3",
				},
			],
		},
	],
};
