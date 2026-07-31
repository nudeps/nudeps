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

			// Netlify doesn't support symlinks, so aliases become redirect rules.
			// Rules match URLs, so both the file and the paths in it are relative to the publish dir,
			// e.g. /child/client_modules/foo/* /child/client_modules/foo@1.0.0/:splat 302
			let { publishDir } = this;
			let url = p => "/" + path.relative(publishDir, p);

			if (url(this.dir).startsWith("/..")) {
				this.warn(
					`${this.dir} is outside the publish directory (${publishDir || "."}), so its redirect rules cannot match any URL. Set the publishDir option.`,
				);
			}

			let redirects = aliasEntries
				.map(
					([aliasPath, target]) =>
						`${url(aliasPath)}/* ${url(path.join(path.dirname(aliasPath), target))}/:splat 302`,
				)
				.join("\n");

			let file = path.join(publishDir, "_redirects");
			// The publish dir may not exist yet: nudeps can run before the build that fills it
			fs.mkdirSync(path.resolve(publishDir), { recursive: true });
			fs.appendFileSync(file, `${redirects}\n`);
			this.info(`Wrote ${aliasEntries.length} alias redirects to ${file}`);
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
