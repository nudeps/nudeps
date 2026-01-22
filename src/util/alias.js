export function getAliasDependencyOverrides (pkg) {
	let deps = pkg?.dependencies;
	if (!deps) {
		return null;
	}

	let overrides = {};
	for (let [name, spec] of Object.entries(deps)) {
		if (typeof spec === "string" && spec.startsWith("npm:")) {
			overrides[name] = `./node_modules/${name}`;
		}
	}

	return Object.keys(overrides).length > 0 ? overrides : null;
}

export function applyAliasOverrides (pkg, overrides) {
	return {
		...pkg,
		dependencies: {
			...(pkg.dependencies ?? {}),
			...overrides,
		},
	};
}
