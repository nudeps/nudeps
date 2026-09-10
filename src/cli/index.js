#!/usr/bin/env node
import nudeps from "../index.js";
import install from "../install.js";
import * as dependents from "../dependents.js";
import readArgs from "./args.js";

let args = readArgs();

if (process.argv.includes("install")) {
	await install();
	await nudeps({ ...args, init: true });
}
else if (process.argv.includes("dependents")) {
	// Register first, so our own local deps can reach us in turn (#86)
	dependents.register();
	dependents.notify();
}
else {
	await nudeps(args);
}
