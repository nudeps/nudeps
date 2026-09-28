import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeJSONSync } from "../src/util.js";

export default {
	name: "Stale entry cleanup",
	description: "Entries a run no longer produces are deleted, along with the folders they empty.",
	/**
	 * Create `dirs`, and symlinks to `target` saved as external aliases by a previous run,
	 * then run a cleanup that produces nothing.
	 * @param {{ dirs?: string[], aliases?: string[], target?: string }} setup
	 * @returns {Promise<string[]>} What is left in the project
	 */
	async run ({ dirs = [], aliases = [], target = "client_modules" }) {
		// Imported here, not at the top: nudeps.js imports package.json,
		// which htest cannot load statically (htest-dev/htest#181).
		let { default: Nudeps } = await import("../src/nudeps.js");
		let root = mkdtempSync(join(tmpdir(), "nudeps-cleanup-"));
		let cwd = process.cwd();

		try {
			process.chdir(root);
			mkdirSync("client_modules");
			mkdirSync(".nudeps");
			for (let dir of dirs) {
				mkdirSync(dir, { recursive: true });
			}
			for (let alias of aliases) {
				symlinkSync(join(root, target), alias);
			}
			writeJSONSync(".nudeps/external-aliases.json", aliases);

			await new Nudeps({ config: { dir: "client_modules" } }).copyPackages();

			return readdirSync(root, { recursive: true }).filter(
				name => !name.startsWith(".nudeps"),
			);
		}
		finally {
			process.chdir(cwd);
			rmSync(root, { recursive: true, force: true });
		}
	},
	tests: [
		{
			name: "A scope folder emptied by the run is deleted",
			arg: { dirs: ["client_modules/@scope/lib"] },
			expect: ["client_modules"],
		},
		{
			name: "An external alias at the project root is deleted",
			description:
				"Its parent is the project root, `\"\"`, which is not ours to delete. Queuing it crashed the run with `rmdir ''`.",
			arg: { aliases: ["lib"] },
			expect: ["client_modules"],
		},
		{
			name: "An external alias of a package removed in the same run is deleted",
			description:
				"The package folder goes first, so the alias is a dangling symlink by the time the run reaches it.",
			arg: {
				dirs: ["client_modules/lib@1"],
				aliases: ["lib"],
				target: "client_modules/lib@1",
			},
			expect: ["client_modules"],
		},
		{
			name: "A project folder emptied by an external alias stays",
			arg: { dirs: ["css"], aliases: ["css/lib"] },
			expect: ["client_modules", "css"],
		},
	],
};
