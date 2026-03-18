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

				// Scope-only directory (e.g. @floating-ui/) — not a package
				if (this.parts[0]?.startsWith("@") && !this.parts[1]) {
					break;
				}

				let isScoped = this.parts[0]?.startsWith("@");
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

	/**
	 * Whether this package is associated with a local/linked dep — either it IS one,
	 * or it's a transitive dep of one. Derived from externalBase.
	 */
	get isExternal () {
		return !!this.externalBase;
	}

	/**
	 * The resolved path of the local/linked dep this package is associated with.
	 * Returns the dep's own resolved path if it IS external, or the parent external's
	 * resolved path for transitive deps. Returns undefined for regular packages.
	 */
	get externalBase () {
		let pkgLock = this.nudeps.pkgLock;

		// This package itself is a local/linked dep
		if (pkgLock.isExternal(this.rawLockKey)) {
			return pkgLock.resolveKey(this.rawLockKey);
		}

		// Base path matches an external dep's resolved path (e.g., ../vue/node_modules/vue)
		if (this.base && this.base !== "." && pkgLock.findKeyByResolvedPath(this.base)) {
			return this.base;
		}

		// Nested under an external package (e.g., node_modules/ext-pkg/node_modules/dep)
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

	/**
	 * Check if the package at this path has a given dependency (in dependencies or devDependencies)
	 * @param {string} name - Dependency name to check for
	 * @returns {boolean}
	 */
	hasDependency (name) {
		let info = this.packageInfo;
		return !!(info?.dependencies?.[name] || info?.devDependencies?.[name]);
	}

	get packageInfo () {
		// For transitive deps of external packages, try the merged child key first.
		// Child entries are keyed by resolvedPath + childKey (e.g., "../vue/node_modules/vue").
		let eb = this.externalBase;
		if (eb) {
			// Case A (base = "../vue"): childKey = rawLockKey (e.g., "node_modules/vue")
			// Case B (nested under ext-pkg): childKey = just the transitive dep part
			let isBaseExternal = this.base === eb;
			let childKey = isBaseExternal
				? this.rawLockKey
				: this.packages
						.slice(1)
						.map(p => "node_modules/" + p)
						.join("/");

			let info = this.nudeps.pkgLock.packages[eb + "/" + childKey];
			if (info) {
				return info;
			}
		}

		return this.nudeps.pkgLock.packages[this.rawLockKey] ?? null;
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
	 * All packages go to top-level client_modules, including transitive deps of local deps.
	 */
	get localDir () {
		if (!this.packageName) {
			return this.nudeps.dir;
		}

		let versionSuffix = this.version ? "@" + this.version : "";
		return [this.nudeps.dir, this.packageName + versionSuffix].join("/");
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
