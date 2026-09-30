import { execSync } from "node:child_process";
import {
	existsSync,
	unlinkSync,
	rmSync,
	rmdirSync,
	cpSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import * as path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

import Hooks from "blissful-hooks";

import { getConfig, getModeWarning } from "./config.js";
import { readJSONSync, writeJSONSync, createGitignoredDir, detectIndent } from "./util.js";
import { ImportMapGenerator, ImportMap } from "./map.js";
import { matchesGlob, ensureSymlink, relativeURL } from "./util/fs.js";
import { stringifyConfig } from "./util/options.js";
import { applyRules, isPackageRule, includeNames } from "./rules.js";
import { getTopLevelModules } from "./util.js";
import Packages from "./util/packages.js";
import * as hosts from "./hosts.js";
import { addHook, hasHook } from "./install.js";

import nudepsPkg from "../package.json" with { type: "json" };

const DEPENDENTS_FILE = ".nudeps/local-dependents.json";

// Commands that rewrite the lockfile after a child's hooks and then fire the root's `dependencies`
// hook, which runs nudeps again against the new one (#171). `update`, `dedupe` and `prune` fire no hook
// afterwards, so their too-early run is the only one there is — skipping those would strand the map.
const REIFY_COMMANDS = ["install", "ci", "uninstall", "link"];

/**
 * @import Package from "./util/package.js"
 * @import { NudepsOptions } from "./options.js"
 */

/**
 * Each instance prepares and writes once: `prepare()`, then `write()`.
 * Calling either again returns the first call's result, even a failed one.
 * To prepare and write again, e.g. for the next build, create a new instance.
 */
export default class Nudeps {
	stats = {
		entries: 0,
		copied: 0,
		deleted: 0,
		linked: 0,
		aliased: 0,
	};
	toCopy = {};
	toAlias = {};
	#cachedExports = null;
	#exportsData = {};
	#exportsDirty = false;
	#prepared;
	#written;

	/**
	 * @param {NudepsOptions} [options] - Overrides taking precedence over the config file and mode defaults.
	 * Resolved into `config` by `prepare()`, so members that read `config` need `prepare()` first.
	 */
	constructor (options = {}) {
		this.options = options;
	}

	/**
	 * Check whether this package resolves against a parent's lockfile that npm
	 * has yet to write or is about to rewrite, so the run that reads it comes later.
	 * `prepare()` and `write()` never check this: call it first to skip such a run.
	 * Logs why a run is deferred, and warns when no later run will come (#172).
	 * @returns {boolean}
	 */
	isDeferred () {
		let root = process.env.npm_config_local_prefix;
		// npm also runs a local dependency's hooks with its consumer as the prefix, but that package has
		// its own, current lockfile — only one resolving against the parent's has to wait for npm.
		if (!root || root === process.cwd() || Packages.findRoot() === process.cwd()) {
			return false;
		}

		// npm fires `dependencies` on the root only, so without that hook nothing ever regenerates
		// this package's map (#172).
		let rootPkg = readJSONSync(path.join(root, "package.json"), { optional: true });
		let delegates = "npm run dependencies --if-present --workspaces";

		if (rootPkg?.workspaces && !hasHook(rootPkg, "dependencies", delegates)) {
			this.warn(
				`The workspace root has no \`dependencies\` hook, so its children's import maps go stale on every install. Run \`npx nudeps install\` here to add it to ${path.join(root, "package.json")}.`,
			);
		}

		// No lockfile yet means nothing to resolve against either way — and it is the only signal
		// left when a hook wraps nudeps in `npx`, whose own npm run replaces `npm_command`.
		if (
			REIFY_COMMANDS.includes(process.env.npm_command) ||
			!existsSync(path.join(root, "node_modules", ".package-lock.json"))
		) {
			this.info(
				"Skipping import map generation: npm hasn't finished updating the lockfile this package resolves against. If this is not a workspace, please run Nudeps from the package root.",
			);
			return true;
		}

		return false;
	}

	/**
	 * Resolve the config, trace the dependency graph and localize the import map in memory.
	 * Writes nothing but nudeps' own caches, so it can run long before `write()`.
	 * @returns {Promise<void>}
	 */
	prepare () {
		return (this.#prepared ??= this.#prepare());
	}

	async #prepare () {
		let start = performance.now();
		this.config = await getConfig(this.options);

		let warning = getModeWarning(this.config.mode, this.config.overrides);
		if (warning) {
			this.warn(warning);
		}

		if (this.config.host) {
			// Adapters may be factories taking the config (e.g. apache)
			let adapter = hosts[this.config.host];
			this.host = typeof adapter === "function" ? adapter(this.config) : adapter;
		}
		else {
			// Auto-detect host
			for (let hostId in hosts) {
				let host = hosts[hostId];
				if (host.detect?.()) {
					this.host = host;
					this.info(`Detected host: ${host.name}`);
					break;
				}
			}
		}

		this.host ??= {};

		if (this.host.hooks) {
			this.hooks.add(this.host.hooks);
		}

		if (this.config.hooks) {
			this.hooks.add(this.config.hooks);
		}

		createGitignoredDir(".nudeps");

		// Delete only the caches. Keep the other .nudeps files:
		// write() needs them to clean up the last run, and they list the local dependents (#164).
		if (this.config.init) {
			rmSync(".nudeps/cache.json", { force: true });
			rmSync(".nudeps/exports.json", { force: true });
		}

		this.$hook("prepare-start");

		for (let warning of this.packages.warnings) {
			this.warn(warning);
		}

		await this.installAll();

		// Rewrite the import map to point at local copies, which write() then materializes in config.dir
		this.localizeMap();

		this.stats.prepareTime = performance.now() - start;
	}

	/**
	 * Materialize client-side dependencies in `config.dir`, write the import map,
	 * and notify local dependents. Runs `prepare()` first if it hasn't run yet.
	 * @returns {Promise<void>}
	 */
	write () {
		return (this.#written ??= this.#write());
	}

	async #write () {
		await this.prepare();

		let start = performance.now();
		let { config } = this;
		let oldConfig = readJSONSync(".nudeps/config.json", { optional: true });

		if (oldConfig && config.dir !== oldConfig.dir && existsSync(oldConfig.dir)) {
			if (config.init) {
				rmSync(oldConfig.dir, { recursive: true });
			}
			else {
				// renameSync needs the destination's parent, and a consumer that clears
				// its output directory before building has just deleted it (#152)
				mkdirSync(path.dirname(config.dir), { recursive: true });
				renameSync(oldConfig.dir, config.dir);
			}
		}

		if (config.init) {
			rmSync(config.dir, { recursive: true, force: true });
		}

		createGitignoredDir(config.dir);

		await this.copyPackages();

		if (oldConfig && oldConfig.map !== config.map && existsSync(oldConfig.map)) {
			rmSync(oldConfig.map);
		}

		// An unchanged map needs no propagation
		let mapContent = this.map.toJS({ module: config.module, terse: config.terse });
		let existingMap = existsSync(config.map) ? readFileSync(config.map, "utf8") : null;
		let mapChanged = mapContent !== existingMap;

		if (mapChanged) {
			mkdirSync(path.dirname(config.map), { recursive: true });
			writeFileSync(config.map, mapContent);
		}

		writeFileSync(".nudeps/config.json", stringifyConfig(config) + "\n");

		this.stats.writeTime = performance.now() - start;
		this.report(mapChanged);

		this.propagate(mapChanged);
	}

	/**
	 * Log what the run changed in `config.dir` and the map, and how long it took.
	 * @param {boolean} mapChanged
	 */
	report (mapChanged) {
		let { config, stats } = this;
		let info = [];
		if (stats.copied + stats.deleted + stats.aliased > 0) {
			let parts = ["copied", "deleted", "aliased"]
				.filter(p => stats[p] > 0)
				.map(p => `${stats[p]} ${p}`);

			let msg =
				parts.length > 2
					? parts.slice(0, -1).join(", ") + ", and " + parts.at(-1)
					: parts.join(" and ");
			info.push(msg + ` in ${config.dir}.`);
		}
		// Leave out the time between prepare() and write().
		// The caller spends it, e.g. on its build.
		let time = stats.prepareTime + stats.writeTime;
		let { cacheHits, cacheMisses } = this.generator.stats;
		let cacheInfo = cacheHits > 0 ? `, ${cacheHits}/${cacheHits + cacheMisses} cached` : "";
		if (mapChanged) {
			info.push(
				`Import map with ${stats.entries} entries generated successfully at ${config.map}. Time taken: ${+time.toFixed(2)} ms (resolve: ${+stats.resolveTime.toFixed(2)} ms${cacheInfo}).`,
			);
		}
		else {
			info.push(
				`Import map unchanged (${stats.entries} entries). Time taken: ${+time.toFixed(2)} ms (resolve: ${+stats.resolveTime.toFixed(2)} ms${cacheInfo}).`,
			);
		}
		this.info(...info);
	}

	hooks = new Hooks();
	$hook (name, env = {}) {
		env.context = this;
		this.hooks.run(name, env);
	}

	async installAll () {
		const generator = this.generator;
		let resolveStart = performance.now();
		try {
			await generator.install(this.pkg.name, ".");
		}
		catch (e) {
			this.error(`Failed to install root package. ${e.message}`);
			// Store the error for potential manual mapping later
			var rootInstallError = e;
		}

		// include: "force" packages install even when pruning; the rest of directDependencies only when not.
		let toInstall = this.config.prune
			? this.directDependencies.filter(name => this.include(name) === "force")
			: this.directDependencies;

		for (const dep of toInstall) {
			try {
				await generator.install(dep);
			}
			catch (e) {
				this.error(`Error installing ${dep}: ${e.message}`);
			}
		}

		this.stats.resolveTime = performance.now() - resolveStart;

		// Finalize (CJS shim install + cache pruning) before the root-mapping fallback below.
		// The shim step is itself an install(), and every install() rebuilds JSPM's map and drops
		// manually-set entries — so the fallback has to be the last thing that touches the map.
		await this.finalize();

		// If the root install failed because the entry point imports a package that isn't installed,
		// JSPM never maps the root package to its own entry point. Resolve the entry point ourselves
		// and pin it — last, so finalize()'s shim install can't wipe it.
		// See https://github.com/nudeps/nudeps/issues/30 and https://github.com/nudeps/nudeps/issues/144
		// Note: string prefix match on JSPM error message — may need updating if JSPM changes it.
		if (rootInstallError?.message.startsWith("Cannot find package")) {
			try {
				let entryPoint = await generator.traceMap.resolver.resolveExport(
					pathToFileURL(process.cwd() + "/").href,
					".",
					false,
					false,
					this.pkg.name,
				);
				generator.map.set(
					this.pkg.name,
					relativeURL(process.cwd(), fileURLToPath(entryPoint)),
				);
			}
			catch (e) {
				this.error(`Failed to manually resolve root package entry point. ${e.message}`);
			}
		}
	}

	// The install cache's key. A cache saved under another key is not reused.
	// The key leaves out `init`, which changes how a run starts, not what it resolves.
	get #cacheKey () {
		let { init, ...config } = this.config;
		// Functions and regexes become source text,
		// so editing one in the config file changes the key.
		return stringifyConfig(config);
	}

	get installCache () {
		// Check the key saved in the cache itself, not .nudeps/config.json.
		// A run that stops after prepare() updates the cache but not config.json.
		let cacheData = readJSONSync(".nudeps/cache.json", { optional: true });
		if (cacheData?.version !== nudepsPkg.version || cacheData.config !== this.#cacheKey) {
			cacheData = null;
		}
		let value = cacheData?.packages ?? {};

		let oldDirNames = new Set(cacheData?.dirNames ?? []);
		let dirNames = new Set(Array.from(this.packages, p => p.dirName));
		// Detect changes: dirNames added, removed, or version-bumped since save
		let changed = oldDirNames.symmetricDifference(dirNames);

		for (let [key, cached] of Object.entries(value)) {
			let urls = [cached.imports ?? {}, ...Object.values(cached.scopes ?? {})].flatMap(b =>
				Object.values(b));
			// URL no longer resolves, or its dirName changed since save → bust the entry
			if (
				urls.some(url => {
					let dirName = this.packages.parse(url).pkg?.dirName;
					return !dirName || changed.has(dirName);
				})
			) {
				delete value[key];
			}
		}

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
			config: this.#cacheKey,
			dirNames: Array.from(this.packages, p => p.dirName),
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

	/**
	 * Pass a change on through the local dependency graph:
	 * register this package with its local deps, then notify its dependents.
	 * Needs no `prepare()`, so a library with no nudeps config of its own can take part (#86).
	 * @param {boolean} [changed=true] Whether this package's import map changed.
	 * Ignored when passing on another package's change.
	 */
	propagate (changed) {
		// Register first, so its local deps can reach this package in turn (#86)
		this.registerAsDependent();
		this.notifyDependents(changed);
	}

	/**
	 * Register this package as a dependent of each local production dependency,
	 * and make sure the dep can notify it back.
	 * Runs unconditionally: it records topology, not a change event.
	 */
	registerAsDependent () {
		let pkg = readJSONSync("./package.json", { optional: true });
		// Nothing installed is normal, not an error: a local dep with no dependencies of its own
		// still has to notify its dependents.
		if (!pkg || Packages.findRoot() === null) {
			return;
		}

		let prodDeps = new Set(Object.keys(pkg.dependencies ?? {}));
		let root = path.resolve(this.packages.prefix);

		for (let dep of this.packages.externals) {
			// nudeps never installs devDependencies, so they have nothing to propagate
			if (!prodDeps.has(dep.installName)) {
				continue;
			}
			if (!existsSync(dep.resolvedPath)) {
				continue;
			}

			// Only outside this package's lockfile root: a workspace sibling shares it,
			// and npm already runs that sibling's hooks on every install.
			if (path.relative(root, path.resolve(dep.resolvedPath)).startsWith("..")) {
				this.#ensurePropagates(dep);
			}

			createGitignoredDir(path.join(dep.resolvedPath, ".nudeps"));

			let dependentsFile = path.join(dep.resolvedPath, DEPENDENTS_FILE);
			let dependents = readJSONSync(dependentsFile, { optional: true }) ?? [];
			let relPath = path.relative(dep.resolvedPath, ".");

			if (!dependents.includes(relPath)) {
				dependents.push(relPath);
				writeJSONSync(dependentsFile, dependents);
			}
		}
	}

	/**
	 * Give a local dependency a `dependencies` hook,
	 * so it can report its changes without nudeps of its own.
	 * @param {Package} dep
	 */
	#ensurePropagates (dep) {
		let pkgPath = path.join(dep.resolvedPath, "package.json");
		let depPkg = readJSONSync(pkgPath, { optional: true });

		if (!depPkg) {
			this.warn(
				`Cannot read ${pkgPath}, so ${dep.installName} will not propagate its changes.`,
			);
			return;
		}

		// A dep already running nudeps notifies this package anyway;
		// a second command would notify it twice
		if (hasHook(depPkg, "dependencies", "nudeps")) {
			return;
		}

		let hook = addHook(depPkg, "dependencies", "npx nudeps dependents");

		if (!hook) {
			this.warn(
				`No free \`dependencies\` hook in ${pkgPath}, so ${dep.installName} will not propagate its changes.`,
			);
			return;
		}

		// The dep's package.json belongs to its own repo, so keep its formatting (#110)
		writeJSONSync(pkgPath, depPkg, detectIndent(pkgPath));
		this.info(`Added \`npx nudeps dependents\` to the \`${hook}\` hook in ${pkgPath}.`);
	}

	/**
	 * Trigger the `dependencies` npm hook in every package that depends on this one locally,
	 * so they regenerate against its updated output. Entries are relative to the cwd.
	 * @param {boolean} [changed=true] Whether this package's import map changed.
	 * Ignored when passing on another package's change.
	 */
	notifyDependents (changed = true) {
		// The cascade spans processes, so its route travels in the environment.
		// Arriving at a package already on the route means a cycle —
		// `a` and `b` depending on each other would notify forever.
		// Per-route, not global, so a diamond still reaches the shared dependent down both branches.
		let route = (process.env.NUDEPS_PROPAGATED ?? "").split(path.delimiter).filter(Boolean);
		let self = realpathSync(".");

		if (route.includes(self)) {
			return;
		}

		// Relaying another package's change:
		// this package's unchanged map proves nothing about theirs,
		// so only a run started in this package may stop on it.
		if (!changed && route.length === 0) {
			return;
		}

		// Skipped, not removed from the file: a directory that is gone today can be back tomorrow, and
		// forgetting it breaks propagation silently — worse than one stat per run (#163).
		let dependents =
			readJSONSync(DEPENDENTS_FILE, { optional: true })?.filter(existsSync) ?? [];
		let env = { ...process.env, NUDEPS_PROPAGATED: [...route, self].join(path.delimiter) };

		for (let entry of dependents) {
			this.info(`Propagating to dependent: ${entry}`);

			try {
				execSync("npm run dependencies --if-present", {
					cwd: entry,
					env,
					stdio: "inherit",
				});
			}
			catch (e) {
				this.error(`Failed to propagate to ${entry}: ${e.message}`);
			}
		}
	}

	get pkg () {
		let value = readJSONSync("./package.json");
		Object.defineProperty(this, "pkg", { value, configurable: true });
		return value;
	}

	// Rules that constrain which packages they apply to; resolved per package by pkgConfig()
	get packageRules () {
		let value = (this.config.overrides ?? []).filter(isPackageRule);
		Object.defineProperty(this, "packageRules", { value, configurable: true });
		return value;
	}

	#pkgConfigs = new Map();

	/**
	 * The effective config for one package: the global config plus every matching
	 * package rule, applied in order (later wins, per property; `ignore` appends).
	 * @param {Package} pkg
	 * @returns {NudepsOptions}
	 */
	pkgConfig (pkg) {
		let value = this.#pkgConfigs.get(pkg);

		if (!value) {
			value = applyRules(this.config, this.packageRules, {
				name: pkg.name,
				installName: pkg.installName,
				version: pkg.version,
				mode: this.config.mode,
			});
			this.#pkgConfigs.set(pkg, value);
		}

		return value;
	}

	/**
	 * The effective `include` setting for a bare specifier, before its Package
	 * necessarily exists (rules can add packages that aren't installed yet).
	 * @param {string} name
	 * @returns {boolean | "force" | undefined}
	 */
	include (name) {
		let pkg = this.packages.get(name);
		return applyRules({}, this.packageRules, {
			name: pkg?.name ?? name,
			installName: pkg?.installName ?? name,
			version: pkg?.version,
			mode: this.config.mode,
		}).include;
	}

	/**
	 * The specifiers nudeps installs directly (beyond what the root trace pulls in): the host's
	 * production `dependencies` plus packages rules add (`include: true` / `"force"`), minus
	 * dropped ones (`include: false`). This is the full (non-pruned) set; `prune` is applied
	 * by `installAll`, which installs only the `include: "force"` subset — not here.
	 * @returns {string[]}
	 */
	get directDependencies () {
		let names = new Set(Object.keys(this.pkg.dependencies ?? {}));

		for (let rule of this.packageRules) {
			if (rule.include === true || rule.include === "force") {
				for (let name of includeNames(rule)) {
					names.add(name);
				}
			}
		}

		return [...names].filter(name => this.include(name) !== false);
	}

	get packages () {
		let value = Packages.load();
		Object.defineProperty(this, "packages", { value, configurable: true });
		return value;
	}

	get generator () {
		let generatorOptions = {
			commonJS: this.config.cjs,
			// The subpaths enum maps onto @jspm/generator's combineSubpaths tri-state
			combineSubpaths: { split: false, combined: true, both: "both" }[this.config.subpaths],
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

		if (this.config.imports) {
			value.applyOverrides({ imports: this.config.imports });
		}

		Object.defineProperty(this, "map", { value, configurable: true });
		return value;
	}

	get dir () {
		return this.config.dir;
	}

	/**
	 * The directory served as `/`, which host adapters need to turn file paths into URLs.
	 * Defaults to the workspace root, which in npm workspaces is typically the deploy root.
	 * @returns {string} Path relative to cwd (`""` when cwd is itself the web root)
	 */
	get root () {
		return this.config.root ?? this.packages.prefix;
	}

	// Tagged, so nudeps' output stays attributable among npm's own.
	// Override these on an instance or a subclass to redirect it.
	info (...messages) {
		console.info("[nudeps]", ...messages);
	}

	warn (...messages) {
		console.warn("[nudeps]", ...messages);
	}

	error (...messages) {
		console.error("[nudeps]", ...messages);
	}

	/**
	 * Compute the output directory for a package: its effective `dir`
	 * (rules can relocate individual packages) plus the versioned dir name.
	 * @param {Package} pkg
	 * @returns {string}
	 */
	localDir (pkg) {
		if (!pkg?.name) {
			return this.dir;
		}

		return path.normalize([this.pkgConfig(pkg).dir, pkg.dirName].join("/"));
	}

	/**
	 * Compute the client_modules output path for a file within a package.
	 * @param {Package} pkg
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
	 * @param {Package} pkg
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
	 * Resolve a package's effective alias setting into alias paths.
	 * @param {Package} pkg
	 * @returns {string[]}
	 */
	aliases (pkg) {
		let alias = this.pkgConfig(pkg).alias;

		if (!alias) {
			return [];
		}

		if (alias === true) {
			// Skip alias when a shallower copy with a different version exists
			let root = this.packages.get(pkg.name);
			return root?.version !== pkg.version ? [] : [pkg.installName];
		}

		return [alias].flat();
	}

	/**
	 * Whether symlinks should be dereferenced (resolved to real paths) when copying a package.
	 * @param {Package} pkg
	 * @returns {boolean}
	 */
	dereference (pkg) {
		return !this.pkgConfig(pkg).preserveSymlinks;
	}

	shouldSymlink (pkg) {
		let { symlink } = this.pkgConfig(pkg);

		if (typeof symlink === "boolean") {
			return symlink;
		}

		// The built-in default: external packages are symlinked
		return symlink(pkg);
	}

	isPathIgnored (filePath, pkg) {
		if (!filePath) {
			return false;
		}

		let ignore = pkg ? this.pkgConfig(pkg).ignore : this.config.ignore;

		// If we traverse backwards we can stop once we find a pattern that would change the inclusion status
		for (let i = ignore.length - 1; i >= 0; i--) {
			let p = ignore[i];
			let glob = p.ignore ?? p.copy;
			let matches = matchesGlob(filePath, glob);

			if (matches) {
				if (!p.ignore) {
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

	/**
	 * Rewrite the import map in place so node_modules specifiers and scopes point at the local
	 * copies under config.dir (versioned, e.g. @foo/bar@3.1.2), and record which package
	 * directories need to be copied there (this.toCopy). Also tallies the total number of map
	 * entries into this.stats.entries. The recorded copies are materialized by copyPackages().
	 */
	localizeMap () {
		let { config, map, stats, packages, toCopy } = this;
		let mapDir = path.dirname(config.map);

		for (let { specifier, url, map: subMap } of map) {
			stats.entries++;

			if (!url.includes("node_modules/")) {
				// Nothing to copy or rewrite
				continue;
			}

			let { pkg, filePath, sourcePath } = packages.parse(url);

			let localPath = pkg ? this.localPath(pkg, filePath) : config.dir + "/" + filePath;
			// Note: relativeURL() might normalize away the trailing slash for directories
			let urlFromMap = relativeURL(mapDir, localPath);
			if (specifier.endsWith("/") && !urlFromMap.endsWith("/")) {
				// Preserve directory specifiers that require a trailing slash in import maps
				urlFromMap += "/";
			}
			subMap[specifier] = urlFromMap;
			if (pkg) {
				toCopy[sourcePath] ??= this.localDir(pkg);
			}
		}

		if (map.scopes) {
			for (let scope in map.scopes) {
				if (!scope.includes("node_modules/")) {
					continue;
				}

				// Rewrite scope itself
				let { pkg: scopePkg } = packages.parse(scope);
				let scopeLocalDir = scopePkg ? this.localDir(scopePkg) : config.dir;
				let scopeFromMap = relativeURL(mapDir, scopeLocalDir);
				map.scopes[scopeFromMap] = map.scopes[scope];
				delete map.scopes[scope];
			}
		}

		// Rule-scoped imports: keys are the matched package's own specifiers, values are
		// package-relative paths — resolved against the package's localized directory.
		// NOTE: emitted as global imports; a rule matching several packages overwrites per spec.
		for (let rule of this.packageRules) {
			if (!rule.imports) {
				continue;
			}

			for (let pkg of packages) {
				if (this.pkgConfig(pkg).imports !== rule.imports) {
					continue;
				}

				for (let [specifier, target] of Object.entries(rule.imports)) {
					if (target === undefined) {
						delete map.imports?.[specifier];
						continue;
					}

					let urlFromMap = relativeURL(mapDir, this.localPath(pkg, target));
					if (specifier.endsWith("/") && !urlFromMap.endsWith("/")) {
						// Preserve directory specifiers that require a trailing slash in import maps
						urlFromMap += "/";
					}
					map.imports ??= {};
					map.imports[specifier] = urlFromMap;
					toCopy[pkg.path] ??= this.localDir(pkg);
				}
			}
		}

		// Also copy aliased packages that have no map entry, e.g. CSS-only packages (#102).
		// aliases() checks the alias option per package, so don't check the global one here.
		for (let dep of this.directDependencies) {
			let pkg = packages.get(dep);

			if (pkg && !pkg.parent && this.aliases(pkg).length > 0) {
				toCopy[pkg.path] ??= this.localDir(pkg);
			}
		}
	}

	async copyPackages () {
		let { config, toCopy, stats } = this;

		// Read now, not in prepare(): a consumer may clear its output between the two (#152)
		let { dirs, symlinks } = getTopLevelModules(config.dir);
		let existingDirs = new Set(dirs.map(d => config.dir + "/" + d));
		let existingSymlinks = new Set(symlinks.map(d => config.dir + "/" + d));

		// Load previously-written external aliases so they enter the deletion queue.
		// They go in both sets because aliases are always symlinks,
		// and existingDirs tracks all entries while existingSymlinks marks which are symlinks.
		let savedExternal = readJSONSync(".nudeps/external-aliases.json", { optional: true }) ?? [];
		for (let p of savedExternal) {
			existingDirs.add(p);
			existingSymlinks.add(p);
		}

		let toDelete = new Set(existingDirs);
		let toDeleteIfEmpty = new Set();

		// Copy (or symlink) package directories. The same package can be reached via
		// multiple link paths (e.g. a linked dep depended on by two other linked deps),
		// yielding several sources for one destination dir — materialize each dest once.
		let materialized = new Set();
		for (let from in toCopy) {
			let to = toCopy[from];
			if (materialized.has(to)) {
				continue;
			}
			materialized.add(to);

			let { pkg } = this.packages.parse(from);

			let exists = existingDirs.has(to);
			let needsRecreate =
				exists && (existingSymlinks.has(to) !== this.shouldSymlink(pkg) || !existsSync(to));

			if (needsRecreate) {
				if (existingSymlinks.has(to)) {
					unlinkSync(to);
				}
				else {
					rmSync(to, { recursive: true });
				}
				toDelete.delete(to);
			}

			if (exists && !needsRecreate) {
				toDelete.delete(to);
			}
			else if (this.shouldSymlink(pkg)) {
				// Create a symlink to the source path (resolves through links for external deps)
				ensureSymlink(path.relative(path.dirname(to), from), to, "dir");
				stats.linked++;
			}
			else {
				stats.copied++;
				if (this.pkgConfig(pkg).ignore.some(p => p.ignore)) {
					pkg.exportedPaths = await this.getExportedPaths(pkg);
				}
				cpSync(from, to, {
					dereference: this.dereference(pkg),
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

			// Create alias symlinks (unversioned paths pointing to versioned directories).
			// Alias paths are relative to the package's effective dir, so they can escape it.
			for (let alias of this.aliases(pkg)) {
				let aliasPath = path.normalize(this.pkgConfig(pkg).dir + "/" + alias);
				let relTarget = path.relative(path.dirname(aliasPath), to);
				let exists = existingDirs.has(aliasPath);

				if (exists) {
					toDelete.delete(aliasPath);
				}

				this.toAlias[aliasPath] = relTarget;
			}
		}

		for (let dir of toDelete) {
			stats.deleted++;
			rmSync(dir, { recursive: true, force: true });

			let parentDir = dir.split("/").slice(0, -1).join("/");

			// Only a `@scope` folder is ours to remove.
			// An external alias's parent belongs to the project (e.g. `""` for the project root).
			// NOTE: a folder nudeps created for an external alias (e.g. `../vendor/lib`) is left behind when empty.
			if (parentDir.startsWith(config.dir + "/")) {
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

		this.createAliases();

		this.saveExports();
	}

	createAliases () {
		let env = {};
		env.resolvedDir = path.resolve(this.dir);
		env.externalAliases = new Set();

		this.$hook("create-aliases-start", env);

		for (let aliasPath in this.toAlias) {
			let target = this.toAlias[aliasPath];

			if (!path.resolve(aliasPath).startsWith(env.resolvedDir + path.sep)) {
				env.externalAliases.add(aliasPath);
			}
		}

		// Persist external alias paths so they can be cleaned up on next run
		if (env.externalAliases?.size > 0) {
			writeJSONSync(".nudeps/external-aliases.json", [...env.externalAliases]);
		}
		else if (existsSync(".nudeps/external-aliases.json")) {
			rmSync(".nudeps/external-aliases.json");
		}

		this.$hook("create-aliases-after-external", env);

		for (let aliasPath in this.toAlias) {
			let target = this.toAlias[aliasPath];

			if (ensureSymlink(target, aliasPath, "dir", { force: true })) {
				this.stats.aliased++;
			}
		}

		this.$hook("create-aliases-end", env);
	}
}
