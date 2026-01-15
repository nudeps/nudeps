import { readJSONSync } from "./util.js";

export function diffLockfiles (
	package_lock = readJSONSync("package-lock.json"),
	old_package_lock = readJSONSync(".nudeps/package-lock.json"),
) {
	if (package_lock.lockfileVersion < 2) {
		// TODO figure out which npm version this corresponds to
		throw new Error(`Only lockfiles >= v2 are supported. Please upgrade npm`);
	}

	return diffPackages(package_lock?.packages, old_package_lock?.packages);
}

/**
 *
 * @param {object} newPackages The .packages object from a package-lock.json file
 * @param {*} [oldPackages] The .packages object from the other package-lock.json file
 * @returns {{installed: Record<string, string>, uninstalled: Record<string, string>, version: Record<string, string>}}
 */
function diffPackages (newPackages = {}, oldPackages = {}) {
	let oldPackagesList = Object.keys(oldPackages);
	let newPackagesList = Object.keys(newPackages);
	let changes = {
		installed: {},
		uninstalled: {},
		version: {},
	};

	let allPackages = new Set([...oldPackagesList, ...newPackagesList]);
	for (let pkg of allPackages) {
		let newVersion = newPackages[pkg]?.version;
		let oldVersion = oldPackages[pkg]?.version;

		if (newVersion === oldVersion) {
			continue;
		}

		if (newVersion) {
			if (oldVersion) {
				changes.version[pkg] = newVersion;
			}
			else {
				changes.installed[pkg] = newVersion;
			}
		}
		else if (oldVersion) {
			changes.uninstalled[pkg] = oldVersion;
		}
	}

	return changes;
}
