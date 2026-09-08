import { stripConditions } from "../../src/util/jspm-overrides.js";

export default {
	name: "stripConditions",
	run: stripConditions,
	tests: [
		{
			name: "Empties a subpath exported only under a type condition",
			description:
				"Left in, JSPM enumerates the subpath but then refuses to resolve it, aborting the batch and silently dropping the subpaths after it.",
			arg: { "./types": { import: { types: "./index.d.ts" } } },
			expect: { "./types": { import: {} } },
		},
		{
			name: "Drops types from nested conditions, keeping the runtime target",
			arg: {
				"./src/*": {
					import: {
						types: "./types/src/*",
						default: "./src/*",
					},
				},
				"./dist/*": "./dist/*",
			},
			expect: {
				"./src/*": {
					import: {
						default: "./src/*",
					},
				},
				"./dist/*": "./dist/*",
			},
		},
		{
			name: "Recurses into array fallback targets",
			arg: {
				"./x": [
					{
						types: "./types/x.d.ts",
						default: "./esm/x.js",
					},
					"./cjs/x.cjs",
				],
			},
			expect: {
				"./x": [
					{
						default: "./esm/x.js",
					},
					"./cjs/x.cjs",
				],
			},
		},
		{
			name: "Keeps unknown conditions but still drops types/typings",
			arg: { "./x": { deno: "./d.js", types: "./d.ts", typings: "./d2.ts" } },
			expect: { "./x": { deno: "./d.js" } },
		},
	],
};
