/**
 * Main entry point
 */

import { readJSONSync, writeJSONSync } from "./util.js";
import { ImportMapGenerator, ImportMap } from "./map.js";
import { matchesGlob, ensureSymlink, findLockfileDir } from "./util/fs.js";

import { getTopLevelModules } from "./util.js";
import { existsSync, rmSync, rmdirSync, cpSync, symlinkSync, mkdirSync } from "node:fs";
import * as path from "node:path";
import Packages from "./util/packages.js";
import nudepsPkg from "../package.json" with { type: "json" };

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
	#cachedExports = null;
	#exportsData = {};
	#exportsDirty = false;

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

	get installCache () {
		let configChanged = JSON.stringify(this.oldConfig) !== JSON.stringify(this.config);
		let cacheData = readJSONSync(".nudeps/cache.json", { optional: true });
		if (cacheData?.version !== nudepsPkg.version || configChanged) {
			cacheData = null;
		}
		let value = cacheData?.packages ?? {};
		Object.defineProperty(this, "installCache", { value, writable: true, configurable: true });
		return value;
	}

	/**
	 * Persist the install cache and exports cache to disk.
	 */
	saveCache () {
		if (Object.keys(this.installCache).length === 0) {
			return;
		}

		writeJSONSync(".nudeps/cache.json", {
			version: nudepsPkg.version,
			packages: this.installCache,
		});
	}

	/**
	 * Finalize after all installs: CJS shim, cache pruning, and cache persistence.
	 */
	async finalize () {
		await this.generator.finalize();
		this.saveCache();
	}

	get pkg () {
		let value = readJSONSync("./package.json");
		Object.defineProperty(this, "pkg", { value, configurable: true });
		return value;
	}

	get packages () {
		// Walk up for the lockfile, which in a workspace lives at the monorepo root.
		let lockDir = findLockfileDir(process.cwd());
		if (lockDir === null) {
			if (existsSync("package.json")) {
				throw new Error("node_modules not found. Run `npm install` first.");
			}
			lockDir = process.cwd();
		}

		// prefix rebases the root-relative lockfile paths to cwd when run in a subdir.
		let inWorkspace = lockDir !== process.cwd();
		let prefix = inWorkspace ? path.relative(process.cwd(), lockDir) : "";

		let data = readJSONSync(path.join(lockDir, "node_modules/.package-lock.json"));
		let raw = data?.packages ?? {};

		// Pre-load child lockfiles for external (linked) deps; `resolved` is relative to lockDir.
		let children = {};
		for (let [key, info] of Object.entries(raw)) {
			if (info.link) {
				let resolvedDir = path.resolve(lockDir, info.resolved);
				let childData = readJSONSync(
					path.join(resolvedDir, "node_modules/.package-lock.json"),
					{ optional: true },
				);
				if (childData) {
					children[info.resolved] = childData;
				}
				else if (inWorkspace) {
					// Workspace siblings hoist their deps — nothing to pre-load.
				}
				else if (!existsSync(path.join(resolvedDir, "node_modules"))) {
					this.info(
						`Warning: node_modules not found at ${info.resolved}. Run \`npm install\` there first.`,
					);
				}
				else {
					this.info(`Warning: No lockfile found at ${info.resolved}`);
				}
			}
		}

		let value = new Packages(data, { children, prefix });
		Object.defineProperty(this, "packages", { value, configurable: true });
		return value;
	}

	get generator () {
		let generatorOptions = {
			commonJS: this.config.cjs,
			combineSubpaths: this.config.combineSubpaths,
			installCache: this.installCache,
			nudeps: this,
		};

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

	get dir () {
		return this.config.dir;
	}

	get elapsedTime () {
		return performance.now() - this.stats.startTime;
	}

	info (...messages) {
		console.info("[nudeps]", ...messages);
	}

	error (...messages) {
		console.error("[nudeps]", ...messages);
	}

	/**
	 * Compute the client_modules output directory for a package.
	 * All packages go to top-level client_modules.
	 * @param {import("./util/package.js").default} pkg
	 * @returns {string}
	 */
	localDir (pkg) {
		if (!pkg?.name) {
			return this.dir;
		}

		return [this.dir, pkg.dirName].join("/");
	}

	/**
	 * Compute the client_modules output path for a file within a package.
	 * @param {import("./util/package.js").default} pkg
	 * @param {string} filePath
	 * @returns {string}
	 */
	localPath (pkg, filePath) {
		return [this.localDir(pkg), filePath].join("/");
	}

	/**
	 * Return the set of concrete exported file paths (relative to the package root) for a package, loading from
	 * .nudeps/exports.json on first access and generating an expanded trace
	 * (expandWildcards: true) on cache miss. The result is stored on pkg.exportedPaths
	 * so isPathIgnored() can access it synchronously during the subsequent cpSync call.
	 * @param {import("./util/package.js").default} pkg
	 * @returns {Promise<Set<string>>}
	 */
	async getExportedPaths (pkg) {
		if (!pkg?.name || !pkg.version || pkg.isExternal) {
			return new Set();
		}

		// Lazily load disk cache for lookups
		if (this.#cachedExports === null) {
			let cacheData = readJSONSync(".nudeps/exports.json", { optional: true });
			this.#cachedExports =
				cacheData?.version === nudepsPkg.version ? (cacheData.packages ?? {}) : {};
		}

		let key = pkg.dirName;

		// Already populated this run (e.g. as a transitive dep of another package's trace)
		if (this.#exportsData[key]) {
			return new Set(this.#exportsData[key]);
		}

		// Cache hit from disk — copy to output and return
		let cached = this.#cachedExports[key];
		if (cached) {
			this.#exportsData[key] = cached;
			return new Set(cached);
		}

		// Cache miss — generate an expanded trace to enumerate concrete exported file paths.
		// Group ALL URLs from the expanded map by package so transitive deps are also
		// populated in one pass, avoiding re-traces on subsequent getExportedPaths calls.
		// silent: true suppresses the CJS shim log from finalize() since this is internal.
		let expandedGen = new ImportMapGenerator({
			...this.generator._options,
			expandWildcards: true,
			combineSubpaths: false,
			silent: true,
		});

		try {
			await expandedGen.install(pkg.installName, pkg.path, { noRetry: true });
			await expandedGen.finalize();
		}
		catch (e) {
			this.info(`Warning: Could not trace exports for ${pkg.name}: ${e.message}`);
			return new Set();
		}

		let expandedMap = expandedGen.getMap();
		let allUrls = [
			...Object.values(expandedMap.imports ?? {}),
			...Object.values(expandedMap.scopes ?? {}).flatMap(s => Object.values(s)),
		];

		for (let url of allUrls) {
			let { pkg: urlPkg, filePath } = this.packages.parse(url);
			if (!urlPkg || !filePath) {
				continue;
			}
			(this.#exportsData[urlPkg.dirName] ??= []).push(filePath);
		}

		this.#exportsDirty = true;
		return new Set(this.#exportsData[key] ?? []);
	}

	/**
	 * Persist the exports cache to .nudeps/exports.json, but only if new entries were
	 * generated this run. Prunes entries for packages not encountered this run.
	 */
	saveExports () {
		if (!this.#exportsDirty) {
			return;
		}

		writeJSONSync(".nudeps/exports.json", {
			version: nudepsPkg.version,
			packages: this.#exportsData,
		});
	}

	/**
	 * Resolve alias config into alias paths for a package.
	 * @param {import("./util/package.js").default} pkg
	 * @param {*} [alias] - Alias config; defaults to this.config.alias
	 * @returns {string[]}
	 */
	aliases (pkg, alias = this.config.alias) {
		if (!alias) {
			return [];
		}

		if (alias === true) {
			return pkg.parent ? [] : [pkg.installName];
		}

		if (Array.isArray(alias)) {
			return alias.flatMap(item => this.aliases(pkg, item));
		}

		if (typeof alias === "string") {
			return pkg.name === alias || pkg.installName === alias ? [alias] : [];
		}

		// Object form: resolve to value via key lookup, then fall through
		if (typeof alias === "object") {
			alias = alias[pkg.installName] ?? alias[pkg.name];
		}

		// Function form (top-level or object value)
		if (typeof alias === "function") {
			alias = alias(pkg);
		}

		return alias == null ? [] : [alias].flat();
	}

	/**
	 * Whether symlinks should be dereferenced (resolved to real paths) when copying a package.
	 * @param {string} packageName
	 * @param {string} version
	 * @returns {boolean}
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

	shouldSymlink (pkg) {
		let { symlink } = this.config;

		if (typeof symlink === "boolean") {
			return symlink;
		}

		return symlink(pkg);
	}

	isPathIgnored (filePath, pkg) {
		if (!filePath) {
			return false;
		}

		let packageName = pkg?.name;

		// If we traverse backwards we can stop once we find a pattern that would change the inclusion status
		for (let i = this.config.ignore.length - 1; i >= 0; i--) {
			let p = this.config.ignore[i];

			if (p.packageName && !p.packageName.includes(packageName)) {
				continue;
			}

			let glob = p.exclude ?? p.include;
			let matches = matchesGlob(filePath, glob);

			if (matches) {
				if (!p.exclude) {
					return false;
				}

				// Don't ignore files that are explicitly exported in the import map
				if (pkg?.exportedPaths?.has(filePath)) {
					return false;
				}

				return true;
			}
		}

		return false;
	}

	async copyPackages () {
		let { config, existingDirs, existingSymlinks, toCopy, toDelete, toDeleteIfEmpty, stats } =
			this;
		this.externalAliases = new Set();
		let resolvedDir = path.resolve(config.dir);

		// Copy (or symlink) package directories
		for (let from in toCopy) {
			let to = toCopy[from];
			let { pkg } = this.packages.parse(from);

			let exists = existingDirs.has(to);
			let needsRecreate = exists && existingSymlinks.has(to) !== this.shouldSymlink(pkg);

			if (needsRecreate) {
				rmSync(to, { recursive: true });
				toDelete.delete(to);
			}

			if (exists && !needsRecreate) {
				toDelete.delete(to);
			}
			else if (this.shouldSymlink(pkg)) {
				// Create a symlink to the source path (resolves through links for external deps)
				let target = path.relative(path.dirname(to), from);
				mkdirSync(path.dirname(to), { recursive: true });
				symlinkSync(target, to, "dir");
				stats.linked++;
			}
			else {
				stats.copied++;
				if (this.config.ignore.some(p => p.exclude)) {
					pkg.exportedPaths = await this.getExportedPaths(pkg);
				}
				cpSync(from, to, {
					dereference: this.dereference(pkg.name, pkg.version),
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

						let { pkg: srcPkg } = this.packages.parse(src);
						return !this.isPathIgnored(relativePath, srcPkg);
					},
				});
			}

			// Create alias symlinks (unversioned paths pointing to versioned directories)
			if (config.alias) {
				for (let alias of this.aliases(pkg)) {
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

		this.saveExports();
	}
}
