import { existsSync } from "node:fs";
import * as path from "node:path";

import Package from "./package.js";
import { readJSONSync } from "./fs.js";

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
	 * Locate and read npm's lockfile(s) from disk, then build a Packages.
	 * Walks up from `cwd` to the nearest node_modules/.package-lock.json — which in an
	 * npm workspace lives at the monorepo root — and rebases paths to cwd accordingly.
	 * @param {string} [cwd]
	 * @param {object} [options]
	 * @param {(message: string) => void} [options.warn] - Called for non-fatal lockfile issues.
	 * @returns {Packages}
	 */
	static load (cwd = process.cwd(), { warn = () => {} } = {}) {
		let dir = cwd;
		while (!existsSync(path.join(dir, "node_modules", ".package-lock.json"))) {
			let parent = path.dirname(dir);
			if (parent === dir) {
				dir = null;
				break;
			}
			dir = parent;
		}

		if (dir === null) {
			if (existsSync(path.join(cwd, "package.json"))) {
				throw new Error("node_modules not found. Run `npm install` first.");
			}
			dir = cwd;
		}

		let prefix = dir !== cwd ? path.relative(cwd, dir) : "";
		let data = readJSONSync(path.join(dir, "node_modules/.package-lock.json"));
		let raw = data?.packages ?? {};

		// Pre-load child lockfiles for external (linked) deps; `resolved` is relative to dir.
		let children = {};
		for (let info of Object.values(raw)) {
			if (!info.link) {
				continue;
			}

			let resolvedDir = path.resolve(dir, info.resolved);
			let childData = readJSONSync(
				path.join(resolvedDir, "node_modules/.package-lock.json"),
				{
					optional: true,
				},
			);

			if (childData) {
				children[info.resolved] = childData;
			}
			else if (prefix) {
				// Workspace siblings hoist their deps — nothing to pre-load.
			}
			else if (!existsSync(path.join(resolvedDir, "node_modules"))) {
				warn(
					`Warning: node_modules not found at ${info.resolved}. Run \`npm install\` there first.`,
				);
			}
			else {
				warn(`Warning: No lockfile found at ${info.resolved}`);
			}
		}

		return new Packages(data, { children, prefix });
	}

	/**
	 * @param {object} data - Lockfile data (npm's .package-lock.json format)
	 * @param {object} [options]
	 * @param {object} [options.children] - Child lockfile data keyed by resolved path, for merging transitive deps of local deps
	 * @param {string} [options.prefix] - cwd→lockfile-dir path (e.g. "../..") for workspaces, to rebase paths to cwd. Keys stay as-is for URL matching.
	 */
	constructor (data, { children = {}, prefix = "" } = {}) {
		this.prefix = prefix;
		let raw = data?.packages ?? {};

		// Rebase a lockfile-relative path to cwd (no prefix keeps the historical "./" form).
		let rebase = p => (prefix ? prefix + "/" + p : "./" + p);

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
				path: rebase(key),
				resolvedPath: info.link
					? prefix
						? prefix + "/" + info.resolved
						: info.resolved
					: undefined,
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
		let effectiveBase = base;
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
				if (pkg) effectiveBase = resolvedBase;
			}
		}

		let sourcePath = (effectiveBase === "." ? "" : effectiveBase + "/") + key;
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
