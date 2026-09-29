#!/usr/bin/env node
import nudeps, { Nudeps } from "../index.js";
import install from "../install.js";
import readArgs from "./args.js";

let args = readArgs();

if (process.argv.includes("install")) {
	await install();
	await nudeps({ ...args, init: true });
}
else if (process.argv.includes("dependents")) {
	new Nudeps().propagate();
}
else {
	await nudeps(args);
}
