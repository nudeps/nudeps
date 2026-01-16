export * from "./util/fs.js";
export * from "./util/paths.js";

export function importCwdRelative (pathFromCwd) {
	return import(pathToFileURL(path.resolve(process.cwd(), pathFromCwd)).href);
}
