/**
 * A single installed package with its metadata and relationships.
 */
export default class Package {
	constructor ({ installName, name, version, path, resolvedPath, parent, info }) {
		this.installName = installName ?? name;
		this.name = name ?? installName;
		this.version = version;
		this.path = path;
		this.resolvedPath = resolvedPath ?? path;
		this.parent = parent ?? null;
		this.info = info ?? null;
	}

	/**
	 * Whether this package is associated with a local/linked dep — either it IS one,
	 * or it's a transitive dep of one. Derived from resolvedPath differing from path,
	 * or having a parent that is external.
	 */
	get isExternal () {
		return this.resolvedPath !== this.path || !!this.parent?.isExternal;
	}

	/**
	 * Versioned directory name, e.g. "vue@3.5.26"
	 */
	get dirName () {
		let suffix = this.version ? "@" + this.version : "";
		return this.name + suffix;
	}

	/**
	 * Check if this package has a given dependency (in dependencies or devDependencies)
	 * @param {string} name
	 * @returns {boolean}
	 */
	hasDependency (name) {
		return !!(this.info?.dependencies?.[name] || this.info?.devDependencies?.[name]);
	}
}
