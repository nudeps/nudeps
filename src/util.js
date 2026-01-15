import {
	readFileSync,
	writeFileSync,
	existsSync,
	readdirSync,
	statSync,
	opendirSync,
} from "node:fs";
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

export function extractTopLevelPackage (url) {
	let start = url.indexOf("node_modules/");
	if (start === -1) {
		return undefined;
	}

	let after = url.slice(start + "node_modules/".length);
	let isScoped = after[0] === "@";
	let packageName = after
		.split("/")
		.slice(0, isScoped ? 2 : 1)
		.join("/");
	return packageName;
}

export function extractTopLevelDirectory (url) {
	let start = url.indexOf("node_modules/");
	if (start === -1) {
		return undefined;
	}

	return url.slice(0, start + "node_modules/".length) + extractTopLevelPackage(url);
}

export function extractPackageLockKey (url) {
	let start = url.indexOf("node_modules/");
	if (start === -1) {
		return undefined;
	}

	let last = url.lastIndexOf("node_modules/");

	if (start !== last) {
		// 2+ level deep
		let after = url.slice(last);
		let lastPackage = extractTopLevelPackage(after);
		return url.slice(start, last) + "node_modules/" + lastPackage;
	}

	return "node_modules/" + extractTopLevelPackage(url);
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
