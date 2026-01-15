import {
	extractTopLevelPackage,
	extractTopLevelDirectory,
	extractPackageLockKey,
} from "../../src/util.js";

export default {
	tests: [
		{
			name: "extractTopLevelPackage()",
			run: extractTopLevelPackage,
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
			name: "extractTopLevelDirectory()",
			run: extractTopLevelDirectory,
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
			name: "extractPackageLockKey()",
			run: extractPackageLockKey,
			tests: [
				{
					arg: "./node_modules/foo/bar/index.js",
					expect: "node_modules/foo",
				},
				{
					arg: "./node_modules/@foo/bar/index.js",
					expect: "node_modules/@foo/bar",
				},
				{
					arg: "./node_modules/foo/node_modules/bar/index.js",
					expect: "node_modules/foo/node_modules/bar",
				},
				{
					arg: "./node_modules/foo/node_modules/@bar/baz/index.js",
					expect: "node_modules/foo/node_modules/@bar/baz",
				},
			],
		},
	],
};
