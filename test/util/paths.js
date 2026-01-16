import { getTopPackage, getTopPackageDirectory, rebaseModulePath } from "../../src/util.js";

export default {
	tests: [
		{
			name: "getTopPackage()",
			run: getTopPackage,
			tests: [
				{
					arg: "./node_modules/foo/bar/index.js",
					expect: "foo",
				},
				{
					arg: "./node_modules/@foo/bar/index.js",
					expect: "@foo/bar",
				},
			],
		},
		{
			name: "getTopPackageDirectory()",
			run: getTopPackageDirectory,
			tests: [
				{
					arg: "./node_modules/foo/bar/index.js",
					expect: "./node_modules/foo",
				},
				{
					arg: "./node_modules/@foo/bar/index.js",
					expect: "./node_modules/@foo/bar",
				},
				{
					arg: "./node_modules/foo/node_modules/bar/index.js",
					expect: "./node_modules/foo",
				},
				{
					arg: "./node_modules/foo/node_modules/@bar/baz/index.js",
					expect: "./node_modules/foo",
				},
				{
					arg: "./node_modules/@foo/bar/node_modules/@baz/quux/index.js",
					expect: "./node_modules/@foo/bar",
				},
			],
		},
		{
			name: "rebaseModulePath()",
			run: rebaseModulePath,
			tests: [
				{
					args: ["./node_modules/foo/bar/index.js", "./client_modules"],
					expect: "./client_modules/foo/bar/index.js",
				},
				{
					args: ["./node_modules/@foo/bar/index.js", "./client_modules"],
					expect: "./client_modules/@foo/bar/index.js",
				},
				{
					args: ["./node_modules/foo/node_modules/bar/index.js", "./client_modules"],
					expect: "./client_modules/foo/node_modules/bar/index.js",
				},
				{
					args: ["./node_modules/foo/node_modules/@bar/baz/index.js", "./client_modules"],
					expect: "./client_modules/foo/node_modules/@bar/baz/index.js",
				},
				{
					args: [
						"./node_modules/@foo/bar/node_modules/@baz/quux/index.js",
						"./client_modules",
					],
					expect: "./client_modules/@foo/bar/node_modules/@baz/quux/index.js",
				},
			],
		},
	],
};
