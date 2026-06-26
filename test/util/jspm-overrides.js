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
		{
			name: "Allowlist mode drops unknown conditions in favor of default",
			arg: { "./x": { deno: "./d.js", default: "./def.js" } },
			expect: { "./x": { default: "./def.js" } },
		},
		{
			name: "Blocklist mode keeps unknowns but still drops types/typings",
			arg: { "./x": { deno: "./d.js", types: "./d.ts", typings: "./d2.ts" } },
			expect: { "./x": { deno: "./d.js" } },
		},
	],
};
