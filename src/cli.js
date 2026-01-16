#!/usr/bin/env node
import nudeps from "./index.js";
import install from "./install.js";

if (process.argv.includes("install")) {
	await install();
	await nudeps({ init: true });
}
else {
	await nudeps();
}
