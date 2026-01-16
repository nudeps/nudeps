import {
	readFileSync,
	writeFileSync,
	existsSync,
	readdirSync,
	statSync,
	opendirSync,
} from "node:fs";
import * as path from "node:path";

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

export function isDirectoryEmptySync (path) {
	const dir = opendirSync(path);
	const entry = dir.readSync();
	dir.closeSync();
	return entry === null;
}
