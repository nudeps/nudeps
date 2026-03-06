import * as nodePath from "node:path";

export default class ModulePath {
	nudeps = null;
	packages = [];
	parent = null;
	path = "";
	parts = [];
	base = [];
	filePath = "";

	static all = {};

	constructor (path, nudeps) {
		this.nudeps = nudeps;

		if (Array.isArray(path)) {
			this.path = path.join("/");
			this.parts = path;
		}
		else {
			this.path = path;
			this.parts = path.split("/");
		}

		let index = this.parts.indexOf("node_modules");
		let isExternal = index === -1;

		if (isExternal) {
			this.base = nodePath.relative(process.cwd(), nodePath.dirname(this.path));
		}
		else {
			this.base = this.parts.splice(0, index).join("/");

			while (this.parts[0] === "node_modules") {
				this.parts.shift();
				let isScoped = this.parts[0].startsWith("@");
				let packageName = this.parts.splice(0, isScoped ? 2 : 1).join("/");
				this.packages.push(packageName);
			}
		}

		this.filePath = this.parts.join("/") ?? "";

		this.parent = this.isNested
			? this.constructor.from([this.base, ...this.packages.slice(0, -1)], this.nudeps)
			: null;
	}

	get isNested () {
		return this.packages.length > 1;
	}

	get isExternal () {
		return this.nudeps.pkgLock.isExternal(this.rawLockKey);
	}

	/**
	 * If this module is a transitive dep of a local/linked dep, returns the resolved path
	 * of that local dep (e.g., "../vue"). Returns undefined otherwise.
	 *
	 * Case A: base matches a resolved path of a linked dep (e.g., base="../vue")
	 * Case B: nested under an external package (e.g., packages=["ext-pkg", "dep"])
	 */
	get externalBase () {
		let pkgLock = this.nudeps.pkgLock;

		// Case A: base is a non-trivial path pointing to a local dep
		if (this.base && this.base !== "." && pkgLock.findKeyByResolvedPath(this.base)) {
			return this.base;
		}

		// Case B: nested under an external (linked) package
		if (this.isNested && pkgLock.isExternal(this.topLockKey)) {
			return pkgLock.resolveKey(this.topLockKey);
		}
	}

	/**
	 * For transitive deps of local deps, returns the ModulePath for the local dep itself
	 */
	get externalParent () {
		let base = this.externalBase;
		if (!base) {
			return null;
		}

		let parentKey = this.nudeps.pkgLock.findKeyByResolvedPath(base);
		if (!parentKey) {
			return null;
		}

		// Create a ModulePath for the local dep itself (e.g., "./node_modules/nudeps-demo-vue")
		return this.constructor.from("./" + parentKey, this.nudeps);
	}

	get packageInfo () {
		let info = this.nudeps.pkgLock.packages[this.rawLockKey] ?? null;

		if (!info && this.externalBase) {
			// Fall back to child lockfile for transitive deps of local deps
			let childLock = this.nudeps.childLock(this.externalBase);
			if (childLock) {
				let childKey;
				if (this.base && this.base !== "." && this.base === this.externalBase) {
					// Case A: use rawLockKey as-is
					childKey = this.rawLockKey;
				}
				else {
					// Case B: strip the parent package
					childKey = this.packages
						.slice(1)
						.map(p => "node_modules/" + p)
						.join("/");
				}
				info = childLock.packages[childKey] ?? null;
			}
		}

		return info;
	}

	get rawLockKey () {
		return this.packages.length > 0
			? this.packages.map(pkg => "node_modules/" + pkg).join("/")
			: this.base;
	}

	get lockKey () {
		return this.nudeps.pkgLock.resolveKey(this.rawLockKey);
	}

	get topLockKey () {
		return "node_modules/" + this.packages[0];
	}

	get version () {
		return this.packageInfo?.version;
	}

	get packageName () {
		return this.packageInfo?.name ?? this.packages.at(-1);
	}

	/**
	 * The name the package was installed under in node_modules.
	 * Differs from packageName when npm aliases are used (e.g. `npm install foo@npm:bar`).
	 */
	get installName () {
		return this.packages.at(-1);
	}

	get aliases () {
		return this.#getAliases();
	}

	/**
	 * Resolve alias config into alias paths for this package.
	 * Supports string, function, array, and object forms. Recurses for arrays.
	 * @param {*} [alias] - Alias config value; defaults to this.nudeps.config.alias
	 * @returns {string[]}
	 */
	#getAliases (alias = this.nudeps.config.alias) {
		if (!alias) {
			return [];
		}

		if (alias === true) {
			return this.isNested ? [] : [this.installName];
		}

		if (Array.isArray(alias)) {
			return alias.flatMap(item => this.#getAliases(item));
		}

		if (typeof alias === "string") {
			return this.packageName === alias || this.installName === alias ? [alias] : [];
		}

		// Object form: resolve to value via key lookup, then fall through
		if (typeof alias === "object") {
			alias = alias[this.installName] ?? alias[this.packageName];
		}

		// Function form (top-level or object value)
		if (typeof alias === "function") {
			alias = alias(this);
		}

		return alias == null ? [] : [alias].flat();
	}

	/**
	 * Get client_modules directory for the package (including version etc).
	 * For transitive deps of local deps, nests under the local dep's client_modules.
	 */
	get localDir () {
		let versionSuffix = this.version ? "@" + this.version : "";
		let versionedName = this.packageName + versionSuffix;

		if (this.externalBase) {
			// Check if the main lockfile already has the same package@version
			let mainInfo = this.nudeps.pkgLock.packages["node_modules/" + this.packageName];
			if (mainInfo?.version === this.version) {
				// Reuse the standard path
				return [this.nudeps.dir, versionedName].join("/");
			}

			// Nest under the local dep's client_modules
			let parent = this.externalParent;
			if (parent) {
				return parent.localDir + "/client_modules/" + versionedName;
			}
		}

		return [this.nudeps.dir, versionedName].join("/");
	}

	/**
	 * Get corresponding path in client_modules
	 */
	get localPath () {
		return [this.localDir, this.filePath].join("/");
	}

	/**
	 * node_modules directory
	 */
	get nodeDir () {
		return [this.base, this.rawLockKey].join("/");
	}

	/**
	 * node_modules directory of parent
	 */
	get topNodeDir () {
		return [this.base, this.topLockKey].join("/");
	}

	toString () {
		return this.path;
	}

	static from (path, nudeps) {
		if (Array.isArray(path)) {
			path = path.join("/");
		}

		if (!this.all[path]) {
			this.all[path] = new ModulePath(path, nudeps);
		}

		return this.all[path];
	}
}
