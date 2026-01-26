import {
	readFileSync,
	writeFileSync,
	existsSync,
	readdirSync,
	statSync,
	opendirSync,
} from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

export function readJSONSync (path) {
	if (!existsSync(path)) {
		return undefined;
	}

	return JSON.parse(readFileSync(path, "utf8"));
}

export function writeJSONSync (path, data, indent = "\t") {
	return writeFileSync(path, JSON.stringify(data, null, indent));
}

export function getTopLevelModules (directory = "./node_modules") {
	try {
		return readdirSync(directory).flatMap(dir => {
			if (statSync(path.join(directory, dir)).isFile()) {
				return [];
			}

			if (dir[0] === "@") {
				return readdirSync(path.join(directory, dir)).flatMap(subdir => `${dir}/${subdir}`);
			}

			return dir;
		});
	}
	catch (e) {
		if (e.code === "ENOENT") {
			return [];
		}

		throw e;
	}
}

export function isDirectoryEmptySync (path) {
	const dir = opendirSync(path);
	const entry = dir.readSync();
	dir.closeSync();
	return entry === null;
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
