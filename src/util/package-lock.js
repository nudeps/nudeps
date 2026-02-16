export default class PackageLock {
	external = {};

	constructor (data) {
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
	}

	resolveKey (key) {
		return this.external[key] ?? key;
	}

	isExternal (key) {
		return key in this.external;
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
