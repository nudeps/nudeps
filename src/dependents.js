/**
 * The local-dependency bookkeeping, with no config, generator or import map behind it, so a library
 * with no frontend of its own can take part without ever installing nudeps (#86).
 */
import { execSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import * as path from "node:path";
import { readJSONSync, writeJSONSync, detectIndent, createGitignoredDir } from "./util.js";
import Packages from "./util/packages.js";
import { addHook } from "./install.js";
import { info, warn, error } from "./util/log.js";

/**
 * @import Package from "./util/package.js"
 */

/**
 * Register this repo as a dependent of each local production dependency, and make sure the dep can
 * notify us back. Runs unconditionally: it records topology, not a change event.
 */
export function register () {
	let pkg = readJSONSync("./package.json", { optional: true });
	// Nothing installed is normal, not an error: a local dep with no dependencies of its own still
	// has to notify its dependents. Lockfile warnings stay silent for the same reason.
	if (!pkg || Packages.findRoot() === null) {
		return;
	}

	let packages = Packages.load();

	let prodDeps = new Set(Object.keys(pkg.dependencies ?? {}));
	let root = path.resolve(packages.prefix);

	for (let dep of packages.externals) {
		// nudeps never installs devDependencies, so they have nothing to propagate to us
		if (!prodDeps.has(dep.installName)) {
			continue;
		}
		if (!existsSync(dep.resolvedPath)) {
			continue;
		}

		// Only outside our own lockfile's root: a workspace sibling shares it, and npm already runs
		// that sibling's hooks on every install.
		if (path.relative(root, path.resolve(dep.resolvedPath)).startsWith("..")) {
			ensurePropagates(dep);
		}

		let depNudepsDir = path.join(dep.resolvedPath, ".nudeps");
		createGitignoredDir(depNudepsDir);

		let dependentsFile = path.join(depNudepsDir, "local-dependents.json");
		let dependents = readJSONSync(dependentsFile, { optional: true }) ?? [];
		let relPath = path.relative(dep.resolvedPath, ".");

		if (!dependents.includes(relPath)) {
			dependents.push(relPath);
			writeJSONSync(dependentsFile, dependents);
		}
	}
}

/**
 * Give a local dependency a `dependencies` hook, so it can tell us it changed without nudeps of its own.
 * @param {Package} dep
 */
function ensurePropagates (dep) {
	let pkgPath = path.join(dep.resolvedPath, "package.json");
	let depPkg = readJSONSync(pkgPath, { optional: true });

	if (!depPkg) {
		warn(`Cannot read ${pkgPath}, so ${dep.installName} will not propagate its changes.`);
		return;
	}

	// A dep already running nudeps notifies us anyway; a second command would notify us twice
	let hooks = ["dependencies", "predependencies", "postdependencies"];
	if (hooks.some(hook => depPkg.scripts?.[hook]?.includes("nudeps"))) {
		return;
	}

	let hook = addHook(depPkg, "dependencies", "npx nudeps dependents");

	if (!hook) {
		warn(
			`No free \`dependencies\` hook in ${pkgPath}, so ${dep.installName} will not propagate its changes.`,
		);
		return;
	}

	// The dep's package.json belongs to its own repo, so keep its formatting (#110)
	writeJSONSync(pkgPath, depPkg, detectIndent(pkgPath));
	info(`Added \`npx nudeps dependents\` to the \`${hook}\` hook in ${pkgPath}.`);
}

/**
 * Trigger the `dependencies` npm hook in every repo that depends on this one locally, so they
 * regenerate against our updated output. Entries are relative to the cwd.
 */
export function notify () {
	// The cascade spans processes, so its route travels in the environment. Arriving somewhere we
	// already came from means a cycle — `a` and `b` depending on each other would notify forever.
	// Per-route, not global, so a diamond still reaches the shared dependent down both branches.
	let route = (process.env.NUDEPS_PROPAGATED ?? "").split(path.delimiter).filter(Boolean);
	let self = realpathSync(".");

	if (route.includes(self)) {
		return;
	}

	let dependents = readJSONSync(".nudeps/local-dependents.json", { optional: true });
	let env = { ...process.env, NUDEPS_PROPAGATED: [...route, self].join(path.delimiter) };

	for (let entry of dependents ?? []) {
		info(`Propagating to dependent: ${entry}`);

		try {
			execSync("npm run dependencies --if-present", { cwd: entry, env, stdio: "inherit" });
		}
		catch (e) {
			error(`Failed to propagate to ${entry}: ${e.message}`);
		}
	}
}
