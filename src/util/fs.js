import {
	readFileSync,
	writeFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	opendirSync,
	symlinkSync,
	readlinkSync,
	unlinkSync,
	rmSync,
} from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Read and parse a JSON file synchronously.
 * By default, throws on missing or invalid files with detectable error codes.
 * @param {string} filePath
 * @param {{ optional?: boolean }} [options]
 * @returns {any} Parsed JSON, or `undefined` if `optional` is set and file is missing/invalid
 * @throws {Error} With `code: "ENOENT"` if file not found
 * @throws {Error} With `code: "ERR_INVALID_JSON"` if file contains invalid JSON (wraps the original SyntaxError as `cause`)
 */
export function readJSONSync (filePath, { optional } = {}) {
	let resolved = path.resolve(filePath);

	if (!existsSync(resolved)) {
		if (optional) {
			return undefined;
		}

		let err = new Error(`File not found: ${resolved}`);
		err.code = "ENOENT";
		throw err;
	}

	try {
		return JSON.parse(readFileSync(resolved, "utf8"));
	}
	catch (e) {
		if (optional) {
			return undefined;
		}

		let err = new Error(`Invalid JSON in ${resolved}: ${e.message}`);
		err.code = "ERR_INVALID_JSON";
		err.cause = e;
		throw err;
	}
}

export function writeJSONSync (path, data, indent = "\t") {
	return writeFileSync(path, JSON.stringify(data, null, indent));
}

/**
 * Read a directory's contents, returning entries with name and symlink info.
 * Uses `withFileTypes` to avoid separate `statSync` calls.
 * @param {string} directory
 * @param {{ type?: "directory" | "file" }} [options]
 * @returns {{ name: string, isSymlink: boolean }[]}
 */
export function readDirectorySync (directory, { type } = {}) {
	try {
		let entries = readdirSync(directory, { withFileTypes: true });

		if (type === "directory") {
			entries = entries.filter(d => d.isDirectory() || d.isSymbolicLink());
		}
		else if (type === "file") {
			entries = entries.filter(d => d.isFile());
		}

		return entries.map(d => ({ name: d.name, isSymlink: d.isSymbolicLink() }));
	}
	catch (e) {
		if (e.code === "ENOENT") {
			return [];
		}

		throw e;
	}
}

/**
 * Get all top-level modules in a directory, handling scoped packages.
 * @param {string} [directory]
 * @returns {{ dirs: string[], symlinks: string[] }} `symlinks` is a subset of `dirs`
 */
export function getTopLevelModules (directory = "./node_modules") {
	let dirs = [];
	let symlinks = [];

	for (let { name, isSymlink } of readDirectorySync(directory, { type: "directory" })) {
		if (name[0] === "@") {
			for (let sub of readDirectorySync(path.join(directory, name), { type: "directory" })) {
				let full = `${name}/${sub.name}`;
				dirs.push(full);
				if (sub.isSymlink) symlinks.push(full);
			}
		}
		else {
			dirs.push(name);
			if (isSymlink) symlinks.push(name);
		}
	}

	return { dirs, symlinks };
}

export function isDirectoryEmptySync (path) {
	const dir = opendirSync(path);
	const entry = dir.readSync();
	dir.closeSync();
	return entry === null;
}

/**
 * Create a directory (if it doesn't exist) with a .gitignore that ignores everything in it.
 * @param {string} dir
 */
export function createGitignoredDir (dir) {
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
		writeFileSync(path.join(dir, ".gitignore"), "*");
	}
}

/**
 * Create a symlink, optionally replacing an existing one.
 * With `force`, removes any existing entry at `linkPath` before creating.
 * @param {string} target - The symlink target (what it points to)
 * @param {string} linkPath - Where to create the symlink
 * @param {"dir"|"file"|"junction"} [type] - Symlink type (passed to symlinkSync)
 * @param {{ force?: boolean }} [options]
 * @returns {boolean} Whether a new symlink was created
 */
export function ensureSymlink (target, linkPath, type, { force } = {}) {
	try {
		if (readlinkSync(linkPath) === target) {
			// Symlink already points to the correct target
			return false;
		}
	}
	catch {}

	if (force) {
		try {
			// rmSync alone skips dangling symlinks (#124)
			unlinkSync(linkPath);
		}
		catch {}
		rmSync(linkPath, { recursive: true, force: true });
	}

	mkdirSync(path.dirname(linkPath), { recursive: true });
	symlinkSync(target, linkPath, type);
	return true;
}

export function importCwdRelative (pathFromCwd) {
	return import(pathToFileURL(path.resolve(process.cwd(), pathFromCwd)).href);
}

/**
 * Matches a path against a glob pattern or array of glob patterns
 * Like `path.matchesGlob()`, but supports arrays of patterns.
 * If array is provided, returns true if any of the patterns match.
 * @param { string } path - The path to match
 * @param { string | string[] } glob - The glob pattern or array of patterns
 * @returns { boolean } Whether the path matches the glob pattern
 */
export function matchesGlob (filePath, glob) {
	if (Array.isArray(glob)) {
		return glob.some(g => path.matchesGlob(filePath, g));
	}

	return path.matchesGlob(filePath, glob);
}
