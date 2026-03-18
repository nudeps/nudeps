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

		// Merge child lockfile entries for external deps, keyed by full path
		// (e.g., "../vue/node_modules/vue") so parse() can find them directly
		for (let pkg of Object.values(this.#byKey)) {
			if (!pkg.isExternal) continue;
			let childRaw = children[pkg.resolvedPath]?.packages ?? {};
			for (let [childKey, childInfo] of Object.entries(childRaw)) {
				if (!childKey) continue;
				let fullKey = pkg.resolvedPath + "/" + childKey;
				if (!(fullKey in this.#byKey)) {
					let installName = childKey.split("node_modules/").at(-1).replace(/\/$/, "");
					this.#byKey[fullKey] = new Package({
						installName,
						name: childInfo?.name ?? installName,
						version: childInfo?.version,
						path: fullKey.startsWith(".") ? fullKey : "./" + fullKey,
						parent: pkg,
						info: childInfo,
					});
				}
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

		// Build indexes
		this.#values = Object.values(this.#byKey);
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
		let base = index === -1 ? null : parts.slice(0, index).join("/") || ".";

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

		let key = packageNames.map(n => "node_modules/" + n).join("/");
		let pkg = this.#byKey[key] ?? null;

		// If not found directly, check if the path goes through an external dep.
		// Case A: base is the external's resolved path (e.g., ../vue/node_modules/vue)
		// Case B: first package is external (e.g., node_modules/ext-pkg/node_modules/dep)
		if (!pkg) {
			let resolvedBase = base && base !== "." ? base : null;

			if (!resolvedBase && packageNames.length > 1) {
				let topPkg = this.#byKey["node_modules/" + packageNames[0]];
				if (topPkg?.resolvedPath !== topPkg?.path) {
					resolvedBase = topPkg.resolvedPath;
					key = packageNames
						.slice(1)
						.map(n => "node_modules/" + n)
						.join("/");
				}
			}

			if (resolvedBase) {
				pkg = this.#byKey[resolvedBase + "/" + key] ?? null;
			}
		}

		let sourcePath = (base === "." ? "" : base + "/") + key;
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
