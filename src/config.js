/**
 * Initialize nudeps for a given project repo
 */

import { importCwdRelative } from "./util.js";
import { existsSync } from "node:fs";
import minimist from "minimist";
import availableOptions from "./options.js";
import builtInModes from "./modes.js";

function readArgs (argv = process.argv.slice(2)) {
	let args = minimist(argv);
	let ret = {};

	for (let key in availableOptions) {
		let option = availableOptions[key];
		if (option.cli === false) {
			continue;
		}

		if (key in args) {
			ret[key] = args[key];
		}
		else if (option.flag in args) {
			ret[key] = args[option.flag];
		}
		else {
			continue;
		}

		if (typeof ret[key] === "string" && option.parse) {
			ret[key] = option.parse(ret[key]);
		}
		else if (
			typeof option.default === "boolean" &&
			(ret[key] === "true" || ret[key] === "false")
		) {
			ret[key] = ret[key] === "true";
		}

		if (option.validate && !option.validate(ret[key])) {
			delete ret[key];
		}
	}

	return ret;
}

function readExternalConfig (args) {
	let configPath = args.config || "nudeps.js";

	if (!existsSync(configPath)) {
		if (args.config) {
			throw new Error(`${args.config} provided as config, but file does not exist`);
		}

		return null;
	}

	return importCwdRelative(configPath).then(m => m.default ?? m);
}

/**
 * Recursively resolve a mode's option defaults by following its `mode` (parent) key.
 * Child values override parent values. When a cycle is detected (e.g. a custom mode
 * extending a same-named built-in like `prod: { mode: "prod", ... }`), falls back
 * to resolving the parent from built-in modes before giving up.
 * @param {string} name - Mode name to resolve
 * @param {object} allModes - All available modes (built-in + custom)
 * @param {object} [options]
 * @param {object} [options.baseModes] - Fallback modes for cycle resolution (defaults to built-in modes)
 * @param {Set} [options.seen] - Tracks visited modes for cycle detection
 * @returns {object} Merged defaults for this mode chain
 */
export function resolveDefaults (name, allModes, { baseModes = builtInModes, seen = new Set() } = {}) {
	if (name === undefined) {
		return {};
	}

	if (!(name in allModes)) {
		let available = Object.keys(allModes).join(", ");
		console.warn(`Unknown mode "${ name }". Available modes: ${ available }`);
		return {};
	}

	if (seen.has(name)) {
		// Cycle — fall back to built-in modes if available (supports
		// custom modes extending same-named built-ins, e.g. prod: { mode: "prod", ... })
		if (baseModes && name in baseModes) {
			return resolveDefaults(name, baseModes, { baseModes: null, seen: new Set() });
		}

		console.warn(`Circular mode reference detected: ${ name }`);
		return {};
	}

	seen.add(name);

	let { mode: parent, ...ownDefaults } = allModes[name];
	let parentDefaults = resolveDefaults(parent, allModes, { baseModes, seen });

	return { ...parentDefaults, ...ownDefaults };
}

/**
 * Get the resolved config regardless of where settings come from
 * @returns
 */
export async function getConfig () {
	let args = readArgs();

	let config = readExternalConfig(args) ?? {};

	if (config.then) {
		config = await config;
	}

	// Resolve mode and its defaults
	let mode = args.mode ?? config.mode;
	let customModes = config.modes ?? {};
	let allModes = { ...builtInModes, ...customModes };
	let modeDefaults = resolveDefaults(mode, allModes);

	let ret = {};
	for (let key in availableOptions) {
		let option = availableOptions[key];
		ret[key] = args[key] ?? config[key] ?? modeDefaults[key];

		if (ret[key] !== undefined) {
			if (option.validate && !option.validate(ret[key])) {
				delete ret[key];
			}
		}

		if (option.normalize) {
			ret[key] = option.normalize(ret[key], option.default);
		}
		else {
			ret[key] ??= option.default;
		}
	}

	return ret;
}
