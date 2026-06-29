import * as fs from "node:fs";
import * as path from "node:path";

export const netlify = ({ publishDir } = {}) => ({
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

			// No publishDir → fall back to the workspace prefix (cwd → lockfile root): in npm workspaces the lockfile root is typically the deploy root
			let pathPrefix = publishDir ?? this.packages.prefix;

			let redirects = aliasEntries
				.map(
					([aliasPath, target]) =>
						`/${path.relative(pathPrefix, aliasPath)}/* /${path.relative(pathPrefix, path.join(path.dirname(aliasPath), target))}/:splat 302`,
				)
				.join("\n");

			fs.appendFileSync(path.join(pathPrefix, "_redirects"), `${redirects}\n`);

			this.info(
				`${this.host.name} host: _redirects written to ${path.resolve(pathPrefix, "_redirects")}`,
			);
		},
	},
});

export const vercel = {
	name: "Vercel",
	detect: () => process.env.VERCEL === "1",
	symlinks: false,
	redirects: true,
};

// same file, same syntax
export const cloudflare = ({ publishDir } = {}) => ({
	...netlify({ publishDir }),
	name: "Cloudflare",
	detect: () => process.env.CLOUDFLARE_PAGES === "true",
});

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
