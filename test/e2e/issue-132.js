import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const NUDEPS_ROOT = resolve(import.meta.dirname, "../..");

// Pull every colorjs.io URL from the generated importmap.js (matches imports and scopes).
function getColorjsUrls (mapJs) {
	return Array.from(mapJs.matchAll(/"colorjs\.io":\s*"([^"]+)"/g), m => m[1]);
}

export default {
	name: "Cache replays stale resolution when transitive dep changes its entry point (issue #132)",
	description:
		"https://github.com/nudeps/nudeps/issues/132. Cached run replays the 0.5.2 entry " +
		"point (dist/color.js); fresh run gives the actual 0.7.0 entry (src/index.js). " +
		"Latent if 0.7.0-alpha.2 ever republishes with the same entry as 0.5.2 — re-pin then.",
	async run () {
		let tmpDir = mkdtempSync(join(tmpdir(), "nudeps-issue-132-"));
		try {
			let pkgPath = join(tmpDir, "package.json");
			let mapPath = join(tmpDir, "importmap.js");

			writeFileSync(
				pkgPath,
				JSON.stringify({
					name: "issue-132-repro",
					version: "1.0.0",
					type: "module",
					dependencies: {
						"color-elements": "0.0.14",
						nudeps: `file:${NUDEPS_ROOT}`,
					},
					overrides: { "colorjs.io": "0.5.2" },
				}),
			);

			let env = { ...process.env, npm_config_audit: "false", npm_config_fund: "false" };
			let exec = cmd => execSync(cmd, { cwd: tmpDir, env, stdio: "ignore" });

			exec("npm install");

			// Populate cache against colorjs.io@0.5.2
			exec("npx nudeps");

			// Upgrade colorjs.io. color-elements stays at 0.0.14 → its cache key is unchanged.
			let pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
			pkg.overrides["colorjs.io"] = "0.7.0-alpha.2";
			writeFileSync(pkgPath, JSON.stringify(pkg));
			exec("npm install");

			exec("npx nudeps");
			let stale = getColorjsUrls(readFileSync(mapPath, "utf8"));

			exec("npx nudeps --init");
			let fresh = getColorjsUrls(readFileSync(mapPath, "utf8"));

			return { stale, fresh };
		}
		finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	},
	check ({ stale, fresh }) {
		// Non-empty AND every URL across both runs collapses to a single value —
		// catches internal inconsistency (imports vs scopes) and cross-run mismatch in one go.
		return stale.length > 0 && fresh.length > 0 && new Set([...stale, ...fresh]).size === 1;
	},
	expect: true,
};
