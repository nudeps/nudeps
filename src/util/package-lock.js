export default class PackageLock {
	external = {};

	/**
	 * @param {object} data - Lockfile data (npm's .package-lock.json format)
	 * @param {object} [options]
	 * @param {object} [options.children] - Child lockfile data keyed by resolved path, for merging transitive deps of local deps
	 */
	constructor (data, { children = {} } = {}) {
		let raw = data.packages ?? {};
		this.packages = {};

		for (let [key, info] of Object.entries(raw)) {
			if (info.link) {
				// Resolve link to the actual package info object
				this.packages[key] = raw[info.resolved];
				this.external[key] = info.resolved;
			}
			else {
				this.packages[key] = info;
			}
		}

		// Merge child lockfile entries for external deps, keyed by full path
		// (e.g., "../vue/node_modules/vue") so parse/packageInfo can find them directly
		for (let resolvedPath of Object.values(this.external)) {
			let childRaw = children[resolvedPath]?.packages ?? {};
			for (let [childKey, childInfo] of Object.entries(childRaw)) {
				if (!childKey) {
					continue;
				}

				let fullKey = resolvedPath + "/" + childKey;
				this.packages[fullKey] ??= childInfo;
			}
		}
	}

	resolveKey (key) {
		return this.external[key] ?? key;
	}

	isExternal (key) {
		return key in this.external;
	}

	keys () {
		return Object.keys(this.packages);
	}

	values () {
		return Object.values(this.packages);
	}

	entries () {
		return Object.entries(this.packages);
	}

	[Symbol.iterator] () {
		return this.entries()[Symbol.iterator]();
	}

	/**
	 * Find all lockfile keys for a package by name, sorted shallowest first.
	 * Matches against the package's `name` field if present, otherwise the install directory name.
	 * @param {string} name - Package name (e.g., "cjs-browser-shim")
	 * @returns {string[]}
	 */
	getPathsFor (name) {
		let suffix = "node_modules/" + name;
		let ret = [];

		for (let [k, info] of this) {
			if (info?.name) {
				if (info.name === name) {
					ret.push(k);
				}
			}
			else {
				// No explicit name, match against install directory name.
				if (k === suffix || k.endsWith("/" + suffix)) {
					ret.push(k);
				}
			}
		}

		return ret.sort((a, b) => a.length - b.length);
	}

	/**
	 * Find a lock key by its resolved path (e.g., "../vue" → "node_modules/nudeps-demo-vue")
	 * @param {string} resolvedPath - The resolved path to look up
	 * @returns {string|undefined} The lock key, or undefined if not found
	 */
	findKeyByResolvedPath (resolvedPath) {
		for (let [key, resolved] of Object.entries(this.external)) {
			if (resolved === resolvedPath) {
				return key;
			}
		}
	}
}
