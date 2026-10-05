import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { netlify, vercel } from "../src/hosts.js";

export default {
	name: "host adapters",
	tests: [
		{
			name: "Netlify keeps generated redirects separate from existing rules",
			run () {
				let root = mkdtempSync(join(tmpdir(), "nudeps-hosts-"));
				let dir = join(root, "client_modules");
				let alias = join(dir, "foo");

				try {
					writeFileSync(join(root, "_redirects"), "/old /new 301");
					netlify.hooks["create-aliases-end"].call({
						root,
						dir,
						toAlias: { [alias]: "foo@1.0.0" },
						info () {},
					});

					return readFileSync(join(root, "_redirects"), "utf8");
				}
				finally {
					rmSync(root, { recursive: true, force: true });
				}
			},
			expect: "/old /new 301\n/client_modules/foo/* /client_modules/foo@1.0.0/:splat 302\n",
		},
		{
			name: "A vercel.json doesn't make a build look like a Vercel build",
			description: "Else a stray vercel.json could outrank the real host's build (#182)",
			run () {
				let root = mkdtempSync(join(tmpdir(), "nudeps-hosts-"));
				let cwd = process.cwd();

				// Synchronous, so no sibling test runs while the cwd is changed
				try {
					writeFileSync(join(root, "vercel.json"), "{}");
					process.chdir(root);
					return Boolean(vercel.detect());
				}
				finally {
					process.chdir(cwd);
					rmSync(root, { recursive: true, force: true });
				}
			},
			expect: false,
		},
	],
};
