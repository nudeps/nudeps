import { relativeURL } from "../../src/util/fs.js";

export default {
	name: "relativeURL",
	run: relativeURL,
	tests: [
		{
			name: "Always explicitly relative",
			tests: [
				{ args: ["/a", "/a/b/c"], expect: "./b/c" },
				{ args: ["/a/b", "/a/c"], expect: "../c" },
				{ args: ["/a", "/a"], expect: "./" },
			],
		},
		{
			name: "Never contains the platform separator (#153)",
			// Import map keys and values are URLs, so they must be "/"-separated even on Windows
			run: (...args) => relativeURL(...args).includes("\\"),
			args: ["/a", "/a/b/c"],
			expect: false,
		},
	],
};
