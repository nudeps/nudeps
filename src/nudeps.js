/**
 * Main entry point
 */

import { readJSONSync } from "./util.js";
import { ImportMapGenerator, ImportMap } from "./map.js";
import ModulePath from "./util/path.js";
import { matchesGlob, ensureSymlink } from "./util/fs.js";

import { getTopLevelModules } from "./util.js";
import { existsSync, rmSync, rmdirSync, cpSync, symlinkSync, mkdirSync } from "node:fs";
import * as path from "node:path";
import PackageLock from "./util/package-lock.js";

export default class Nudeps {
	stats = {
		entries: 0,
		copied: 0,
		deleted: 0,
		linked: 0,
		aliased: 0,
		startTime: performance.now(),
	};
	toCopy = {};
	toDelete = null;
	toDeleteIfEmpty = new Set();

	constructor ({ config }) {
		this.config = config;
		this.oldConfig = readJSONSync(".nudeps/config.json", { optional: true });

		let { dirs, symlinks } = config.init
			? { dirs: [], symlinks: [] }
			: getTopLevelModules(config.dir);
		this.existingDirs = new Set(dirs.map(d => config.dir + "/" + d));
		this.existingSymlinks = new Set(symlinks.map(d => config.dir + "/" + d));

		// Load previously-written external aliases so they enter the deletion queue.
		// They go in both sets because aliases are always symlinks,
		// and existingDirs tracks all entries while existingSymlinks marks which are symlinks.
		let savedExternal = config.init
			? []
			: (readJSONSync(".nudeps/external-aliases.json", { optional: true }) ?? []);
		for (let p of savedExternal) {
			this.existingDirs.add(p);
			this.existingSymlinks.add(p);
		}

		this.toDelete = new Set(this.existingDirs);
		this.hasIgnoreExceptions = this.config.ignore.some(p => p.include);
		this.hasDeepGlobs = this.config.ignore.some(p => (p.include ?? p.exclude)?.includes("/"));
	}

	get pkg () {
		let value = readJSONSync("./package.json");
		Object.defineProperty(this, "pkg", { value, configurable: true });
		return value;
	}

	get pkgLock () {
		if (!existsSync("node_modules") && existsSync("package.json")) {
			throw new Error("node_modules not found. Run `npm install` first.");
		}

		let data = readJSONSync("node_modules/.package-lock.json");
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
			let nmDir = `${resolvedPath}/node_modules`;

			if (!existsSync(nmDir) && existsSync(`${resolvedPath}/package.json`)) {
				this.info(
					`Warning: node_modules not found at ${resolvedPath}. Run \`npm install\` there first.`,
				);
				this.#childLocks[resolvedPath] = null;
			}
			else {
				let data = readJSONSync(`${nmDir}/.package-lock.json`, { optional: true });
				if (data) {
					this.#childLocks[resolvedPath] = new PackageLock(data);
				}
				else {
					this.info(`Warning: No lockfile found at ${resolvedPath}`);
					this.#childLocks[resolvedPath] = null;
				}
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
				return !this.config.preserveSymlinks({ packageName, version });
		}

		if (Array.isArray(this.config.preserveSymlinks)) {
			// Array of package names
			return !this.config.preserveSymlinks.includes(packageName);
		}

		return true;
	}

	shouldSymlink (mp) {
		let { symlink } = this.config;

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
		let { config, existingDirs, existingSymlinks, toCopy, toDelete, toDeleteIfEmpty, stats } =
			this;
		this.externalAliases = new Set();
		let resolvedDir = path.resolve(config.dir);

		// Copy (or symlink) package directories
		for (let from in toCopy) {
			let to = toCopy[from];
			let mp = this.path(from);

			let exists = existingDirs.has(to);
			let needsRecreate = exists && existingSymlinks.has(to) !== this.shouldSymlink(mp);

			if (needsRecreate) {
				rmSync(to, { recursive: true });
				toDelete.delete(to);
			}

			if (exists && !needsRecreate) {
				toDelete.delete(to);
			}
			else if (this.shouldSymlink(mp)) {
				// Create a symlink to the resolved local path
				let resolvedPath = this.pkgLock.resolveKey(mp.rawLockKey);
				let target = path.relative(path.dirname(to), resolvedPath);
				mkdirSync(path.dirname(to), { recursive: true });
				symlinkSync(target, to, "dir");
				stats.linked++;
			}
			else {
				stats.copied++;
				let { packageName, version } = mp;
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

			// Create alias symlinks (unversioned paths pointing to versioned directories)
			if (config.alias) {
				for (let alias of mp.aliases) {
					let aliasPath = path.normalize(config.dir + "/" + alias);
					let relTarget = path.relative(path.dirname(aliasPath), to);
					let exists = existingDirs.has(aliasPath);

					if (exists) {
						toDelete.delete(aliasPath);
					}

					// Track aliases that resolve outside config.dir
					if (!path.resolve(aliasPath).startsWith(resolvedDir + path.sep)) {
						this.externalAliases.add(aliasPath);
					}

					if (ensureSymlink(relTarget, aliasPath, "dir", { force: exists })) {
						stats.aliased++;
					}
				}
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
