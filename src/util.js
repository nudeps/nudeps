import { readFileSync, writeFileSync, existsSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function readJSONSync (path) {
	if (!existsSync(path)) {
		return undefined;
	}

	return JSON.parse(readFileSync(path, "utf8"));
}

export function writeJSONSync (path, data) {
	return writeFileSync(path, JSON.stringify(data, null, "\t"));
}

export function importCwdRelative (pathFromCwd) {
	return import(pathToFileURL(path.resolve(process.cwd(), pathFromCwd)).href);
}
