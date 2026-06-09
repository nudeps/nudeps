import { stripConditions } from "../../src/util/jspm-overrides.js";

export default {
	name: "stripConditions",
	run: exports => stripConditions(exports, ["production", "browser", "module", "import"]),
	tests: [
		{
			name: "Strips types condition shadowing default (#126)",
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
	],
};
