/**
 * Main entry point
 */

import { readJSONSync } from "./util.js";
import { ImportMapGenerator, ImportMap, mergeImportMaps } from "./map.js";
import ModulePath from "./util/path.js";
import { matchesGlob, ensureSymlink } from "./util/fs.js";

import { getTopLevelModules } from "./util.js";
import { existsSync, rmSync, rmdirSync, cpSync, symlinkSync, mkdirSync } from "node:fs";
import * as path from "node:path";
import PackageLock from "./util/package-lock.js";

const DEFAULT_PROVIDER = "esm.sh";

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

		let { dirs, symlinks } = config.init ? { dirs: [], symlinks: [] } : getTopLevelModules(config.dir);
		this.existingDirs = new Set(dirs.map(d => config.dir + "/" + d));
		this.existingSymlinks = new Set(symlinks.map(d => config.dir + "/" + d));
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
		let data = readJSONSync("package-lock.json");
		let value = new PackageLock(data);
		Object.defineProperty(this, "pkgLock", { value, configurable: true });
		return value;
	}

	get generator () {
		let generatorOptions = { commonJS: this.config.cjs };

		// Tell JSPM to ignore external packages so it doesn't resolve them locally;
		// other packages that depend on them fall back to top-level import map entries
		let externalNames = [...this.externalPackages.keys()];
		if (externalNames.length > 0) {
			generatorOptions.ignore = externalNames;
		}

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

	/**
	 * Resolve the external provider for a dependency.
	 * Returns a provider name string (e.g. "esm.sh") or null if the dep is not external.
	 * @param {string} dep - The install name (key under pkg.dependencies)
	 * @param {*} [external] - External config value; defaults to this.config.external
	 * @returns {string|null}
	 */
	resolveExternal (dep, external = this.config.external) {
		let lockKey = `node_modules/${dep}`;
		let info = this.pkgLock.packages[lockKey];
		let installName = dep;
		let packageName = info?.name ?? dep;
		let version = info?.version;

		return this.#resolveExternalValue(external, { installName, packageName, version });
	}

	/**
	 * Recursively resolve an external config value for a given package context.
	 * Supports true, string (package name match), array, object (key lookup), and function forms.
	 * After object/function fall-through: true → default provider, string → provider name.
	 */
	#resolveExternalValue (value, ctx) {
		if (value == null || value === false) return null;
		if (value === true) return DEFAULT_PROVIDER;

		if (Array.isArray(value)) {
			for (let item of value) {
				let result = this.#resolveExternalValue(item, ctx);
				if (result) return result;
			}
			return null;
		}

		// Top-level string = match by package name
		if (typeof value === "string") {
			return ctx.installName === value || ctx.packageName === value ? DEFAULT_PROVIDER : null;
		}

		// Object form: key lookup, then fall through
		if (typeof value === "object") {
			value = value[ctx.installName] ?? value[ctx.packageName];
		}

		// Function form (top-level or object value)
		if (typeof value === "function") {
			value = value(ctx);
		}

		// Fall-through resolution: true → default, string → provider name
		if (value === true) return DEFAULT_PROVIDER;
		if (typeof value === "string") return value;
		return null;
	}

	/**
	 * Map of external packages: installName → { provider, packageName, version }.
	 * Iterates pkg.dependencies and resolves each against the external config.
	 */
	get externalPackages () {
		let result = new Map();
		let deps = this.pkg.dependencies;

		if (deps) {
			for (let dep in deps) {
				let provider = this.resolveExternal(dep);
				if (provider) {
					let info = this.pkgLock.packages[`node_modules/${dep}`];
					result.set(dep, {
						provider,
						packageName: info?.name ?? dep,
						version: info?.version,
					});
				}
			}
		}

		Object.defineProperty(this, "externalPackages", { value: result, configurable: true });
		return result;
	}

	/**
	 * Install external packages from CDN providers.
	 * Groups packages by provider, creates a separate ImportMapGenerator per provider,
	 * installs each package, and returns the merged import map.
	 * @returns {Promise<object>} Merged { imports, scopes } from all CDN generators
	 */
	async installExternalPackages () {
		if (this.externalPackages.size === 0) return {};

		// Group by provider
		let groups = {};
		for (let [installName, { provider, packageName, version }] of this.externalPackages) {
			groups[provider] ??= [];
			groups[provider].push({ installName, packageName, version });
		}

		let maps = [];

		for (let [providerName, packages] of Object.entries(groups)) {
			let generator = new ImportMapGenerator({
				defaultProvider: providerName,
				commonJS: this.config.cjs,
			});

			for (let { installName, packageName, version } of packages) {
				let target = version ? `${packageName}@${version}` : packageName;

				if (!version) {
					this.info(`Warning: No version found for external package ${installName}, using latest`);
				}

				try {
					await generator.install(installName, target);
				}
				catch (e) {
					this.error(`Error installing external package ${installName} from ${providerName}: ${e.message}`);
				}
			}

			maps.push(generator.getMap());
		}

		return mergeImportMaps(...maps);
	}

	#childLocks = {};

	/**
	 * Load and cache a child package's lockfile for resolving transitive deps of local deps
	 * @param {string} resolvedPath - Resolved path to the local dep (e.g., "../vue")
	 * @returns {PackageLock|null}
	 */
	childLock (resolvedPath) {
		if (!(resolvedPath in this.#childLocks)) {
			let data = readJSONSync(`${resolvedPath}/package-lock.json`, { optional: true });
			if (data) {
				this.#childLocks[resolvedPath] = new PackageLock(data);
			}
			else {
				this.info(`Warning: No package-lock.json found at ${resolvedPath}`);
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
		let { config, existingDirs, existingSymlinks, toCopy, toDelete, toDeleteIfEmpty, stats } = this;

		// Copy (or symlink) package directories
		for (let from in toCopy) {
			let to = toCopy[from];
			let mp = this.path(from);

			let exists = existingDirs.has(to);
			let needsRecreate = exists && (existingSymlinks.has(to) !== this.shouldSymlink(mp));

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
					let aliasPath = config.dir + "/" + alias;
					let relTarget = path.relative(path.dirname(aliasPath), to);
					let exists = existingDirs.has(aliasPath);

					if (exists) {
						toDelete.delete(aliasPath);
					}

					if (ensureSymlink(relTarget, aliasPath, "dir", { force: exists, skipIfCorrect: exists })) {
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
