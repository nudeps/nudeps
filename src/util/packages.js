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
	 * Find the nearest ancestor (or `cwd` itself) with `node_modules/.package-lock.json`.
	 * In npm workspaces this is the monorepo root; npm never writes the hidden
	 * lockfile inside workspace children, even those with their own `node_modules/`.
	 * @param {string} [cwd]
	 * @returns {string|null}
	 */
	static findRoot (cwd = process.cwd()) {
		let dir = cwd;
		while (!existsSync(path.join(dir, "node_modules", ".package-lock.json"))) {
			let parent = path.dirname(dir);
			if (parent === dir) {
				return null;
			}
			dir = parent;
		}
		return dir;
	}

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
		let dir = Packages.findRoot(cwd);

		if (dir === null) {
			if (existsSync(path.join(cwd, "package.json"))) {
				throw new Error("node_modules not found. Run `npm install` first.");
			}
			dir = cwd;
		}

		let prefix = dir !== cwd ? path.relative(cwd, dir) : "";
		let data = readJSONSync(path.join(dir, "node_modules/.package-lock.json"), {
			optional: true,
		});
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
				{ optional: true },
			);

			if (childData) {
				children[prefix ? prefix + "/" + info.resolved : info.resolved] = childData;
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
						? rebase(info.resolved)
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

		if (index === -1) {
			return (this.#parseCache[url] = { pkg: null, filePath: "", sourcePath: url });
		}

		// Re-express base relative to the lockfile dir so it matches #byKey's keys (URLs and
		// pkg.path are cwd-relative). With a workspace prefix the cwd→root prefix maps to the
		// lockfile root "." (root keys stay raw, e.g. "node_modules/foo"), while resolved
		// external paths are kept as-is. Without a prefix, drop a leading "./" so a re-parsed
		// sourcePath (pkg.path, which carries "./") still matches.
		let base = parts.slice(0, index).join("/") || ".";
		if (this.prefix) {
			if (base === this.prefix) {
				base = ".";
			}
			else if (base === ".") {
				// cwd's own node_modules (non-hoisted dep). Find the child path from lockfile keys.
				for (let key of Object.keys(this.#byKey)) {
					let index = key.indexOf("/node_modules/");
					if (index > 0 && !key.startsWith(".") && !key.startsWith("node_modules/")) {
						base = key.slice(0, index);
						break;
					}
				}
			}
		}
		else {
			base = base.replace(/^\.\//, "");
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
				// Global installs don't produce a child lockfile; try hoisted root
				key = "node_modules/" + name;
				pkg = this.#byKey[key] ?? null;
				if (!pkg) {
					break;
				}
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
