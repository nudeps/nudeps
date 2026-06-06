import * as fs from "node:fs";
import * as path from "node:path";

export const netlify = {
	name: "Netlify",
	detect: () => process.env.NETLIFY === "true",
	symlinks: false,
	redirects: true,
	hooks: {
		["create-aliases-end"] () {
			let aliasEntries = Object.entries(this.toAlias);
			if (aliasEntries.length === 0) {
				return;
			}

			// Netlify doesn't support symlinks, add _rewrites
			let redirectsFile = fs.openSync("_redirects", "a");
			let redirects = aliasEntries
				.map(
					([aliasPath, target]) =>
						`/${aliasPath}/* /${path.join(path.dirname(aliasPath), target)}/:splat 302`,
				)
				.join("\n");
			fs.writeSync(redirectsFile, `${redirects}\n`);
			fs.closeSync(redirectsFile);
		},
	},
};

export const vercel = {
	name: "Vercel",
	detect: () => process.env.VERCEL === "1",
	symlinks: false,
	redirects: true,
};

// same file, same syntax
export const cloudflare = {
	...netlify,
	name: "Cloudflare",
	detect: () => process.env.CLOUDFLARE_PAGES === "true",
};

export const apache = ({ publishDir, file = ".htaccess" } = {}) => ({
	name: "Apache",
	symlinks: true, // TODO detect FollowSymLinks
	redirects: true,
});

export const gitHubPages = {
	name: "GitHub Pages",
	detect: () => process.env.GITHUB_ACTIONS === "true" && process.env.GITHUB_REPOSITORY,
	symlinks: false,
	redirects: false, // Can hack them with 404.html but too far reaching for Nudeps to do by default.
};
