/**
 * Get the top-level package name from a URL
 * E.g. ./node_modules/@foo/bar/node_modules/@baz/quux/index.js -> @foo/bar
 * @param {string} url
 * @returns {string}
 */
export function getTopPackage (url) {
	let parts = url.split("/");
	let index = parts.indexOf("node_modules");
	if (index === -1) {
		return undefined;
	}

	let dirIndex = index + (parts[index + 1].startsWith("@") ? 2 : 1);
	return parts.slice(index + 1, dirIndex + 1).join("/");
}

/**
 * Get the top-level package directory from a URL
 * E.g. ./node_modules/@foo/bar/node_modules/@baz/quux/index.js -> ./node_modules/@foo/bar
 * @param {string} url
 * @returns {string}
 */
export function getTopPackageDirectory (url) {
	let parts = url.split("/");
	let index = parts.indexOf("node_modules");
	if (index === -1) {
		return url;
	}

	let dirIndex = index + (parts[index + 1].startsWith("@") ? 2 : 1);
	return parts.slice(0, dirIndex + 1).join("/");
}

/**
 * Remove part of path up to node_modules/ and replace with a new directory
 * E.g. ./node_modules/@foo/bar/node_modules/@baz/quux/index.js -> ./client_modules/@foo/bar/node_modules/@baz/quux/index.js
 * @param {string} url
 * @param {string} dir
 * @returns {string}
 */
export function rebaseModulePath (url, dir) {
	let parts = url.split("/");
	let index = parts.indexOf("node_modules");
	if (index === -1) {
		return url;
	}

	parts.splice(0, index + 1, dir);
	return parts.join("/");
}

/**
 * Add the version number to the top-level package
 * E.g. ./node_modules/@foo/bar/node_modules/@baz/quux/index.js -> ./node_modules/@foo/bar@3.1.2/node_modules/@baz/quux/index.js
 * @param {string} url
 * @param {Record<string, { version: string }>} packages - package-lock.json packages object
 * @returns {string}
 */
export function addVersion (url, packages) {
	let parts = url.split("/");
	let index = parts.indexOf("node_modules");
	if (index === -1) {
		return url;
	}

	let dirIndex = index + (parts[index + 1].startsWith("@") ? 2 : 1);
	let lockKey = parts.slice(index, dirIndex + 1).join("/");
	let version = packages?.[lockKey]?.version;
	parts[dirIndex] += version ? "@" + version : "";
	return parts.join("/");
}
