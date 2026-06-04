import { readJSONSync, writeJSONSync } from "./util.js";
import { execSync } from "node:child_process";
import * as path from "node:path";

/**
 * Add a command to an npm lifecycle hook, falling back to pre/post variants if the hook is already taken.
 */
function addHook (pkg, hook, command) {
	pkg.scripts ??= {};

	for (let name of [hook, "pre" + hook, "post" + hook]) {
		if (pkg.scripts[name]?.includes(command)) {
			// Already there
			return;
		}
		if (!pkg.scripts[name]) {
			pkg.scripts[name] = command;
			return;
		}
	}
}

export default async function () {
	let pkg = readJSONSync("package.json", { optional: true });

	// Install nudeps as a devDependency if not already present
	if (!pkg?.devDependencies?.nudeps && !pkg?.dependencies?.nudeps) {
		let command = "npm install nudeps -D";
		console.info("Nudeps not found, installing via", command, "...");
		execSync(command, { stdio: "inherit" });

		// Re-read package.json
		pkg = readJSONSync("package.json");
		pkg.type ??= "module";
	}

	let command = "npx nudeps";
	addHook(pkg, "dependencies", command);
	addHook(pkg, "prepare", command);

	writeJSONSync("package.json", pkg, 2);

	// Handle workspaces: walk up to find a parent with `workspaces`.
	// Can't use npm_config_local_prefix — it's only set during npm lifecycle hooks, not `npx nudeps install`.
	let dir = path.dirname(process.cwd());
	while (dir !== path.dirname(dir)) {
		let rootPkg = readJSONSync(path.join(dir, "package.json"), { optional: true });

		if (rootPkg?.workspaces) {
			// Add hooks that delegate to children, so `npm install` at the root re-triggers nudeps after the lockfile is written.
			for (let hook of ["dependencies", "prepare"]) {
				addHook(rootPkg, hook, `npm run ${hook} --if-present --workspaces`);
			}
			writeJSONSync(path.join(dir, "package.json"), rootPkg);
			break;
		}

		dir = path.dirname(dir);
	}
}
