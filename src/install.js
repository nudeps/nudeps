import { readJSONSync, writeJSONSync, detectIndent } from "./util.js";
import Packages from "./util/packages.js";
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

	// These are the user's files, so keep their formatting (#110)
	writeJSONSync("package.json", pkg, detectIndent("package.json"));

	// Handle workspaces: if cwd's lockfile lives at a parent, that parent is the workspace root.
	let root = Packages.findRoot();
	if (root && root !== process.cwd()) {
		let rootPkgPath = path.join(root, "package.json");
		let rootPkg = readJSONSync(rootPkgPath, { optional: true });

		if (rootPkg?.workspaces) {
			// Add hooks that delegate to children, so `npm install` at the root re-triggers nudeps after the lockfile is written.
			for (let hook of ["dependencies", "prepare"]) {
				addHook(rootPkg, hook, `npm run ${hook} --if-present --workspaces`);
			}
			writeJSONSync(rootPkgPath, rootPkg, detectIndent(rootPkgPath));
		}
	}
}
