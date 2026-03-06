import { readJSONSync, writeJSONSync } from "./util.js";
import { execSync } from "node:child_process";

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
	}

	let command = "npx nudeps";
	addHook(pkg, "dependencies", command);
	addHook(pkg, "prepare", command);

	writeJSONSync("package.json", pkg, 2);
}
