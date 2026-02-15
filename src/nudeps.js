/**
 * Main entry point
 */

import { readJSONSync } from "./util.js";
import { ImportMapGenerator, ImportMap } from "./map.js";
import ModulePath from "./util/path.js";
import { matchesGlob } from "./util/fs.js";

import { getTopLevelModules } from "./util.js";
import { existsSync, rmSync, rmdirSync, cpSync, symlinkSync, mkdirSync } from "node:fs";
import * as path from "node:path";
import PackageLock from "./util/package-lock.js";

export default class Nudeps {
	stats = { entries: 0, copied: 0, deleted: 0, startTime: performance.now() };
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
		let data = readJSONSync("package-lock.json");
		if (!data) {
			throw new Error("package-lock.json not found or invalid");
		}
		let value = new PackageLock(data);
		Object.defineProperty(this, "pkgLock", { value, configurable: true });
		return value;
	}

	get generator () {
		let generatorOptions = { commonJS: this.config.cjs };

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

	#childLocks = {};

	/**
	 * Load and cache a child package's lockfile for resolving transitive deps of local deps
	 * @param {string} resolvedPath - Resolved path to the local dep (e.g., "../vue")
	 * @returns {PackageLock|null}
	 */
	childLock (resolvedPath) {
		if (!(resolvedPath in this.#childLocks)) {
			let data = readJSONSync(`${ resolvedPath }/package-lock.json`);
			if (data) {
				this.#childLocks[resolvedPath] = new PackageLock(data);
			}
			else {
				this.info(`Warning: No package-lock.json found at ${ resolvedPath }`);
				this.#childLocks[resolvedPath] = null;
			}
		}
		return this.#childLocks[resolvedPath];
	}

	get packages () {
		return this.pkgLock?.packages ?? {};
	}

	get dir () {
		return this.config.dir;
	}

	get elapsedTime () {
		return performance.now() - this.stats.startTime;
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
	dereference (packageName, version) {
		switch (typeof this.config.preserveSymlinks) {
			case "boolean":
				return !this.config.preserveSymlinks;
			case "function":
				return !this.config.preserveSymlinks({packageName, version});
		}

		if (Array.isArray(this.config.preserveSymlinks)) {
			// Array of package names
			return !this.config.preserveSymlinks.includes(packageName);
		}

		return true;
	}

	shouldSymlink (mp) {
		let {symlink} = this.config;

		if (typeof symlink === "boolean") {
			return symlink;
		}

		return symlink(mp);
	}

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
				let mp = this.path(from);
				let {packageName, version} = mp;
				cpSync(from, to, {
					dereference: this.dereference(packageName, version),
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
