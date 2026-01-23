/**
 * Main entry point
 */

import { readJSONSync, fixAliases } from "./util.js";
import { ImportMapGenerator, ImportMap } from "./map.js";
import ModulePath from "./util/path.js";

export default class Nudeps {
	stats = { entries: 0, copied: 0, deleted: 0 };

	constructor ({ config }) {
		this.config = config;
		this.oldConfig = readJSONSync(".nudeps/config.json");
	}

	get pkg () {
		let value = readJSONSync("./package.json");
		if (!value) {
			throw new Error("package.json not found or invalid");
		}
		Object.defineProperty(this, "pkg", { value, configurable: true });
		return value;
	}

	get pkgLock () {
		let value = readJSONSync("package-lock.json");
		if (!value) {
			throw new Error("package-lock.json not found or invalid");
		}
		Object.defineProperty(this, "pkgLock", { value, configurable: true });
		return value;
	}

	get generator () {
		let generatorOptions = { commonJS: this.config.cjs };

		// JSPM Generator does not support npm aliases (npm:), so we override the
		// root package config to point alias deps at their local node_modules paths.
		// See https://github.com/jspm/jspm/issues/2687
		let aliasOptions = fixAliases(this.pkg);
		Object.assign(generatorOptions, aliasOptions);

		let value = new ImportMapGenerator(generatorOptions);
		Object.defineProperty(this, "generator", { value, configurable: true });
		return value;
	}

	get map () {
		let value = new ImportMap(this.generator);
		value.cleanupScopes();

		if (this.config.overrides) {
			value.applyOverrides(this.config.overrides);
		}

		Object.defineProperty(this, "map", { value, configurable: true });
		return value;
	}

	get packages () {
		return this.pkgLock?.packages ?? {};
	}

	get dir () {
		return this.config.dir;
	}

	path (url) {
		return ModulePath.from(url, this);
	}

	info (...messages) {
		console.info("[nudeps]", ...messages);
	}

	error (...messages) {
		console.error("[nudeps]", ...messages);
	}
}
