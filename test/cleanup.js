import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeJSONSync } from "../src/util.js";

const NUDEPS = new URL("../src/nudeps.js", import.meta.url).href;

export default {
	name: "Stale entry cleanup",
	description: "Entries a run no longer produces are deleted, along with the folders they empty.",
	/**
	 * Create `dirs`, and symlinks to `target` saved as external aliases by a previous run,
	 * then run a cleanup that produces nothing.
	 * @param {{ dirs?: string[], aliases?: string[], target?: string }} setup
	 * @returns {string[]} What is left in the project
	 */
	run ({ dirs = [], aliases = [], target = "client_modules" }) {
		let root = mkdtempSync(join(tmpdir(), "nudeps-cleanup-"));

		try {
			mkdirSync(join(root, "client_modules"));
			mkdirSync(join(root, ".nudeps"));
			for (let dir of dirs) {
				mkdirSync(join(root, dir), { recursive: true });
			}
			for (let alias of aliases) {
				symlinkSync(join(root, target), join(root, alias));
			}
			writeJSONSync(join(root, ".nudeps/external-aliases.json"), aliases);

			// A child process gets its own cwd, which parallel sibling tests would otherwise share
			let code = `import Nudeps from ${JSON.stringify(NUDEPS)}; await new Nudeps({ config: { dir: "client_modules" } }).copyPackages();`;
			execFileSync(process.execPath, ["--input-type=module", "-e", code], {
				cwd: root,
				stdio: "ignore",
			});

			return readdirSync(root, { recursive: true }).filter(
				name => !name.startsWith(".nudeps"),
			);
		}
		finally {
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
