import { resolveDefaults } from "../../src/config.js";
import builtInModes from "../../src/modes.js";

export default {
	name: "resolveDefaults",
	data: { modes: builtInModes },
	run (name) {
		return resolveDefaults(name, this.data.modes);
	},
	tests: [
		{
			name: "built-in modes",
			tests: [
				{
					arg: "dev",
					expect: { symlink: true },
				},
				{
					arg: "prod",
					expect: { symlink: false, prune: true, terse: true },
				},
			],
		},
		{
			name: "custom mode inheriting from prod",
			data: {
				modes: {
					...builtInModes,
					staging: { mode: "prod", prune: false },
				},
			},
			tests: [
				{
					arg: "staging",
					expect: { symlink: false, prune: false, terse: true },
				},
			],
		},
		{
			name: "custom mode extending same-named built-in",
			data: {
				modes: {
					...builtInModes,
					prod: { mode: "prod", prune: false },
				},
			},
			tests: [
				{
					arg: "prod",
					expect: { symlink: false, prune: false, terse: true },
				},
			],
		},
		{
			name: "deep inheritance chain",
			data: {
				modes: {
					base: { a: 1 },
					mid: { mode: "base", b: 2 },
					leaf: { mode: "mid", c: 3 },
				},
			},
			tests: [
				{
					arg: "leaf",
					expect: { a: 1, b: 2, c: 3 },
				},
			],
		},
		{
			name: "cycle detection",
			data: {
				modes: {
					a: { mode: "b" },
					b: { mode: "a" },
				},
			},
			tests: [
				{
					arg: "a",
					expect: {},
				},
			],
		},
		{
			name: "unknown mode",
			data: { modes: { dev: { symlink: true } } },
			tests: [
				{
					arg: "nonexistent",
					expect: {},
				},
			],
		},
		{
			name: "undefined mode",
			tests: [
				{
					arg: undefined,
					expect: {},
				},
			],
		},
	],
};
