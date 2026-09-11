#!/usr/bin/env node
import nudeps from "../index.js";
import install from "../install.js";
import readArgs from "./args.js";

let args = readArgs();

// The subcommand is the first argument; a leading dash makes it a flag, so there is no subcommand
let [command] = process.argv.slice(2);
if (command?.startsWith("-")) {
	command = undefined;
}

if (command === "install") {
	await install();
	await nudeps({ ...args, init: true });
}
else if (command === undefined) {
	await nudeps(args);
}
else {
	// A typo, or a subcommand from a newer nudeps, must not silently regenerate the map
	console.error(`[nudeps] Unknown command: ${command}`);
	process.exitCode = 1;
}
