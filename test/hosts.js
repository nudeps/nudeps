import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { netlify } from "../src/hosts.js";

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
	],
};
