#!/usr/bin/env node
import { Nudeps } from "../index.js";
import install from "../install.js";
import readArgs from "./args.js";

let { options, warnings } = readArgs();
let installing = process.argv.includes("install");
let nudeps = new Nudeps(installing ? { ...options, init: true } : options);

for (let warning of warnings) {
	nudeps.warn(warning);
}

if (installing) {
	await install();
}

if (process.argv.includes("dependents")) {
	nudeps.propagate();
}
else if (!nudeps.isDeferred()) {
	await nudeps.write();
}
