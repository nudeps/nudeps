/**
 * Built-in mode presets that package up multiple option defaults.
 * `dev` optimizes for local development; `prod` optimizes for deployment.
 */
export default {
	dev: { symlink: true },
	prod: { symlink: false, prune: true, terse: true },
};
