/**
 * Main entry point
 */

import { readJSONSync, fixDependencies } from "./util.js";
import { ImportMapGenerator, ImportMap } from "./map.js";
import ModulePath from "./util/path.js";
import { matchesGlob } from "./util/fs.js";

import { getTopLevelModules } from "./util.js";
import { existsSync, rmSync, rmdirSync, cpSync } from "node:fs";
import * as path from "node:path";

export default class Nudeps {
	stats = { entries: 0, copied: 0, deleted: 0 };
	toCopy = {};
	toDelete = null;
	toDeleteIfEmpty = new Set();

	constructor ({ config }) {
		this.config = config;
		this.oldConfig = readJSONSync(".nudeps/config.json");

		this.existingDirs = new Set(
			config.init ? [] : getTopLevelModules(config.dir).map(d => config.dir + "/" + d),
		);
		this.toDelete = new Set(this.existingDirs);
		this.hasIgnoreExceptions = this.config.ignore.some(p => p.include);
		this.hasDeepGlobs = this.config.ignore.some(p => (p.include ?? p.exclude)?.includes("/"));
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

		// JSPM Generator does not support npm aliases (npm:) and partially supports GitHub URLs,
		// so we override the root package config to point alias deps at their local node_modules paths
		// and remove the github: prefix from GitHub deps to avoid freezes.
		// See https://github.com/jspm/jspm/issues/2687 and https://github.com/jspm/jspm/issues/2688
		Object.assign(generatorOptions, fixDependencies(this.pkg));

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

	/**
	 * Check if a path is ignored by the ignore configuration
	 * @param {*} path
	 * @returns
	 */
	isPathIgnored (path, packageName) {
		if (!path) {
			return false;
		}

		// If we traverse backwards we can stop once we find a pattern that would change the inclusion status
		for (let i = this.config.ignore.length - 1; i >= 0; i--) {
			let p = this.config.ignore[i];

			if (p.packageName && !p.packageName.includes(packageName)) {
				continue;
			}

			let glob = p.exclude ?? p.include;
			let matches = matchesGlob(path, glob);

			if (matches) {
				return Boolean(p.exclude);
			}
		}

		return false;
	}

	copyPackages () {
		let { config, existingDirs, toCopy, toDelete, toDeleteIfEmpty, stats } = this;

		// Copy package directories
		for (let from in toCopy) {
			let to = toCopy[from];
			if (existingDirs.has(to)) {
				toDelete.delete(to);
			}
			else {
				stats.copied++;
				cpSync(from, to, {
					dereference: true,
					preserveTimestamps: true,
					recursive: true,
					filter: src => {
						// Path from package root
						let relativePath = path.relative(from, src);

						if (
							relativePath.includes("node_modules/") ||
							relativePath.endsWith("node_modules")
						) {
							// Always skip nested node_modules directories
							return false;
						}

						let { packageName } = this.path(src);
						return !this.isPathIgnored(relativePath, packageName);
					},
				});
			}
		}

		for (let dir of toDelete) {
			if (existsSync(dir)) {
				stats.deleted++;
				rmSync(dir, { recursive: true });
			}

			let parentDir = dir.split("/").slice(0, -1).join("/");

			if (parentDir !== config.dir) {
				toDeleteIfEmpty.add(parentDir);
				continue;
			}
		}

		for (let parentDir of toDeleteIfEmpty) {
			try {
				rmdirSync(parentDir);
				stats.deleted++;
			}
			catch (e) {
				if (e.code === "ENOTEMPTY" || e.code === "EEXIST") {
					// Directory is not empty, skip
					continue;
				}

				throw e;
			}
		}
	}
}
