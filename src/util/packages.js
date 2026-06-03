import Package from "./package.js";

export { Package };

/**
 * Collection of installed packages, parsed from a package manager's lockfile.
 * Currently handles npm's node_modules/.package-lock.json format.
 */
export default class Packages {
	#byKey = {};
	#byName = {};
	#values = [];
	#parseCache = {};

	/**
	 * @param {object} data - Lockfile data (npm's .package-lock.json format)
	 * @param {object} [options]
	 * @param {object} [options.children] - Child lockfile data keyed by resolved path, for merging transitive deps of local deps
	 */
	constructor (data, { children = {} } = {}) {
		let raw = data?.packages ?? {};

		for (let [key, info] of Object.entries(raw).filter(([key, info]) => key)) {
			if (!key) {
				continue; // Skip root entry
			}

			let resolved = info.link ? raw[info.resolved] : info;
			let installName = key.split("node_modules/").at(-1).replace(/\/$/, "");

			this.#byKey[key] = new Package({
				installName,
				name: resolved?.name,
				version: resolved?.version,
				path: "./" + key,
				resolvedPath: info.link ? info.resolved : undefined,
				info: resolved,
			});
		}

		this.#values = Object.values(this.#byKey);

		// Merge child lockfile entries for external deps, keyed by full path
		// (e.g., "../vue/node_modules/vue") so parse() can find them directly
		for (let pkg of this.#values) {
			if (!pkg.isExternal) {
				continue;
			}

			let childRaw = children[pkg.resolvedPath]?.packages ?? {};

			for (let [childKey, childInfo] of Object.entries(childRaw)) {
				if (!childKey) {
					continue;
				}

				let fullKey = pkg.resolvedPath + "/" + childKey;
				if (fullKey in this.#byKey) {
					continue;
				}

				let installName = childKey.split("node_modules/").at(-1).replace(/\/$/, "");
				let childPkg = new Package({
					installName,
					name: childInfo?.name,
					version: childInfo?.version,
					path: fullKey.startsWith(".") ? fullKey : "./" + fullKey,
					parent: pkg,
					info: childInfo,
				});

				this.#byKey[fullKey] = childPkg;
				this.#values.push(childPkg);
			}
		}

		// Set up parent references for nested packages (non-merged entries only)
		for (let [key, pkg] of Object.entries(this.#byKey)) {
			if (pkg.parent) continue; // Already set (merged child entries)
			let lastNM = key.lastIndexOf("/node_modules/");
			if (lastNM > 0) {
				pkg.parent = this.#byKey[key.slice(0, lastNM)] ?? null;
			}
		}

		// Build #byName index
		for (let pkg of this.#values) {
			this.#byName[pkg.name] ??= pkg;
		}
	}

	/**
	 * Get a package by name. Checks install path first, then package name.
	 * @param {string} name
	 * @returns {Package|undefined}
	 */
	get (name) {
		return this.#byKey["node_modules/" + name] ?? this.#byName[name];
	}

	has (name) {
		return this.get(name) !== undefined;
	}

	/**
	 * Find all installed copies of a package, sorted shallowest first.
	 * @param {string} name
	 * @returns {Package[]}
	 */
	getAll (name) {
		return this.#values
			.filter(p => p.name === name || p.installName === name)
			.sort((a, b) => a.path.length - b.path.length);
	}

	/**
	 * All external (local/linked) packages (not their transitive deps).
	 * @returns {Package[]}
	 */
	get externals () {
		return this.#values.filter(p => p.resolvedPath !== p.path);
	}

	/**
	 * Parse a URL/path into a Package reference and file path.
	 * @param {string} url
	 * @returns {{ pkg: Package|null, filePath: string, sourcePath: string }}
	 */
	parse (url) {
		if (this.#parseCache[url]) {
			return this.#parseCache[url];
		}

		let parts = url.split("/");
		let index = parts.indexOf("node_modules");
		// Drop any leading "./" so base matches #byKey's key format (keys have no "./",
		// but pkg.path does, so re-parsing a sourcePath would otherwise miss).
		let base = index === -1 ? null : (parts.slice(0, index).join("/") || ".").replace(/^\.\//, "");

		if (index === -1) {
			return (this.#parseCache[url] = { pkg: null, filePath: "", sourcePath: url });
		}

		let rest = parts.slice(index);
		let packageNames = [];

		while (rest[0] === "node_modules") {
			rest.shift();

			// Scope-only directory (e.g. @floating-ui/) — not a package
			if (rest[0]?.startsWith("@") && !rest[1]) {
				break;
			}

			let isScoped = rest[0]?.startsWith("@");
			packageNames.push(rest.splice(0, isScoped ? 2 : 1).join("/"));
		}

		let filePath = rest.join("/");

		if (packageNames.length === 0) {
			return (this.#parseCache[url] = { pkg: null, filePath, sourcePath: url });
		}

		// Walk the package chain one segment at a time, following each linked dep's
		// resolved target before resolving the next. JSPM emits symbolic node_modules
		// paths, but npm records a linked package's subtree under its resolved location,
		// so every intermediate link must be dereferenced — not just the first.
		let pkg = null;
		let cursor = base;
		for (let name of packageNames) {
			let key = (cursor === "." ? "" : cursor + "/") + "node_modules/" + name;
			pkg = this.#byKey[key] ?? null;
			if (!pkg) {
				break;
			}
			// Descend into the link target for external deps, else the package's own dir.
			cursor = pkg.resolvedPath !== pkg.path ? pkg.resolvedPath : key;
		}

		let sourcePath = pkg ? pkg.path : url;
		if (!sourcePath.startsWith(".")) sourcePath = "./" + sourcePath;

		return (this.#parseCache[url] = { pkg, filePath, sourcePath });
	}

	values () {
		return this.#values;
	}

	[Symbol.iterator] () {
		return this.#values[Symbol.iterator]();
	}
}
