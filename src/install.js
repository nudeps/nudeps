import { readJSONSync, writeJSONSync } from "./util.js";
import nudeps from "./index.js";

/**
 * Add a command to an npm lifecycle hook, falling back to pre/post variants if the hook is already taken.
 */
function addHook (pkg, hook, command) {
	for (let name of [hook, "pre" + hook, "post" + hook]) {
		if (pkg.scripts[name]?.includes(command)) {
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

	if (!pkg) {
		console.info("package.json not found, creating stub...");
		pkg = { name: process.cwd().split("/").pop() };
	}

	pkg.scripts ??= {};

	let command = "npx nudeps";
	addHook(pkg, "dependencies", command);
	addHook(pkg, "prepare", command);

	writeJSONSync("package.json", pkg, 2);
}
