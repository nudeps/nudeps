export default class PackageLock {
	#resolvedKeys = {};

	constructor (data) {
		let raw = data.packages ?? {};
		this.packages = {};

		for (let [key, info] of Object.entries(raw)) {
			if (info.link) {
				// Resolve link to the actual package info object
				this.packages[key] = raw[info.resolved];
				this.#resolvedKeys[key] = info.resolved;
			}
			else {
				this.packages[key] = info;
			}
		}
	}

	resolveKey (key) {
		return this.#resolvedKeys[key] ?? key;
	}

	isExternal (key) {
		return key in this.#resolvedKeys;
	}
}
