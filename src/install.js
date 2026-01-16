import { readJSONSync, writeJSONSync } from "./util.js";
import nudeps from "./index.js";

export default async function () {
	let pkg = readJSONSync("package.json");

	if (!pkg) {
		console.info("package.json not found, creating stub...");
		pkg = { name: process.cwd().split("/").pop() };
	}

	pkg.scripts ??= {};

	let hooks = ["dependencies", "predependencies", "postdependencies"];
	let command = "npx nudeps";
	for (const hook of hooks) {
		if (pkg.scripts[hook]?.includes(command)) {
			// Already installed
			break;
		}
		if (!pkg.scripts[hook]) {
			pkg.scripts[hook] = command;
			break;
		}
	}

	writeJSONSync("package.json", pkg, 2);
}
