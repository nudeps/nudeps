import { join } from "node:path";

const FIXTURES = join(import.meta.dirname, "fixtures");

export default {
	name: "ImportMapGenerator.install()",
	async run (name) {
		// Imported here, not at the top: map.js itself imports package.json for the version it
		// stamps on the map, which htest cannot load statically (htest-dev/htest#181).
		let { ImportMapGenerator } = await import("../../src/map.js");

		// Without a Nudeps instance nothing is cacheable, so installs take the JSPM path directly
		// — the one the retry lives on.
		let gen = new ImportMapGenerator();
		await gen.install(name, join(FIXTURES, name));

		return Object.keys(gen.getMap().imports ?? {}).sort();
	},
	tests: [
		{
			name: "Maps a package with neither `main` nor `exports`",
			description:
				"JSPM enumerates no subpaths for these and drops the implicit index.js with them, reporting success either way — so the package would leave no trace in the map.",
			arg: "bare",
			expect: ["bare"],
		},
		{
			name: "Maps a package exporting only subpaths",
			description:
				"Re-installing this one without subpath enumeration throws, so a retry that mistakes it for an empty resolution surfaces here.",
			arg: "subpaths-only",
			expect: ["subpaths-only/foo"],
		},
		{
			name: "Leaves an asset-only package with no JS entry point alone",
			description:
				"Nothing to resolve here, so the retry throws and must swallow it: mapping nothing is the right answer, and an error would be a regression for CSS/font-only packages (#102).",
			arg: "no-entry",
			expect: [],
		},
	],
};
