import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Packages from "../../src/util/packages.js";

const FIXTURES = join(import.meta.dirname, "fixtures");

// Stands in for Nudeps: the generator only reads lock data from it, and that is what locates the
// shim when it lives under a linked nudeps instead of the project's node_modules.
const nudeps = {
	packages: new Packages({
		packages: { "node_modules/cjs-browser-shim": { version: "0.0.1" } },
	}),
};

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
		{
			name: "Resolves an entry point's `cjs-browser-shim` import",
			description:
				"nudeps provides the shim, so it resolves through the lockfile — a linked nudeps leaves it out of the project's node_modules (#159). A temp directory reproduces that: nothing above it holds the shim.",
			async run () {
				let { ImportMapGenerator, ImportMap } = await import("../../src/map.js");
				let dir = mkdtempSync(join(tmpdir(), "nudeps-shim-"));

				try {
					writeFileSync(
						join(dir, "package.json"),
						JSON.stringify({ name: "shim-repro", type: "module", main: "index.js" }),
					);
					writeFileSync(join(dir, "index.js"), `import "cjs-browser-shim";\n`);

					let gen = new ImportMapGenerator({ nudeps });
					await gen.install("shim-repro", dir, { noRetry: true });

					// The shim resolves into a scope, so look at the whole map, not just imports.
					return [...new ImportMap(gen)].map(entry => entry.specifier).sort();
				}
				finally {
					rmSync(dir, { recursive: true, force: true });
				}
			},
			expect: ["cjs-browser-shim", "shim-repro"],
		},
	],
};
