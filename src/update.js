import { readJSONSync, writeJSONSync } from "./util.js";
import { existsSync } from "node:fs";
import init from "./init.js";

export default async function update () {
	if (!existsSync(".nudeps")) {
		// First run
		return init();
	}

	let config = await getConfig();
	let oldConfig = readJSONSync(".nudeps/config.json");

	if (oldConfig) {
		// Check if any important settings changed
		if (config.map !== oldConfig.map && existsSync(oldConfig.map)) {
			// Rename old import map to new name
			renameSync(oldConfig.map, config.map);
		}

		if (config.dir !== oldConfig.dir && existsSync(oldConfig.dir)) {
			renameSync(oldConfig.dir, config.dir);
			// TODO update .gitignore?
		}

		// TODO handle changed exclude
		// TODO handle changed prune
	}
}

export async function diffDeps (
	package_lock = readJSONSync("package-lock.json"),
	old_package_lock = readJSONSync(".nudeps/package-lock.json"),
) {
	if (package_lock.lockfileVersion < 3) {
		// TODO figure out which npm version this corresponds to
		throw new Error(`Only lockfiles >= v3 are supported. Please upgrade npm`);
	}

	let changes = diffPackages(package_lock.packages, old_package_lock?.packages);

	let packagesChanged = Object.assign(...Object.values(changes));

	if (Object.keys(packagesChanged).length === 0) {
		// Nothing to do here
		return;
	}

	// writeJSONSync("changes.json", changes);
	return changes;
}

/**
 *
 * @param {object} newPackages The .packages object from a package-lock.json file
 * @param {*} [oldPackages] The .packages object from the other package-lock.json file
 * @returns
 */
function diffPackages (newPackages, oldPackages) {
	let oldPackagesList = oldPackages ? Object.keys(oldPackages) : [];
	let newPackagesList = newPackages ? Object.keys(newPackages) : [];
	let changes = {
		installed: {},
		uninstalled: {},
		version: {},
	};

	if (!oldPackages || Object.keys(oldPackages).length === 0) {
		if (newPackages && Object.keys(newPackages).length > 0) {
			changes.installed = newPackages;
		}

		return changes;
	}

	if (!newPackages || Object.keys(newPackages).length === 0) {
		changes.uninstalled = oldPackages;
		return changes;
	}

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
			changes.uninstalled = oldVersion;
		}
	}

	return changes;
}
