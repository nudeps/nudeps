import { detectIndent } from "../../src/util/fs.js";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

let __dirname = path.dirname(fileURLToPath(import.meta.url));
let tmpDir = path.join(__dirname, ".tmp-indent");

export default {
	name: "detectIndent",
	beforeAll () {
		mkdirSync(tmpDir, { recursive: true });
	},
	afterAll () {
		rmSync(tmpDir, { recursive: true, force: true });
	},
	/** Write `content` to a file, then detect its indentation. */
	run (content, fallback) {
		let file = path.join(tmpDir, "test.json");
		rmSync(file, { force: true });

		if (content !== undefined) {
			writeFileSync(file, content);
		}

		return detectIndent(file, fallback);
	},
	tests: [
		{
			name: "Detects indentation",
			tests: [
				{ name: "2 spaces", arg: '{\n  "a": 1\n}\n', expect: "  " },
				{ name: "4 spaces", arg: '{\n    "a": 1\n}\n', expect: "    " },
				{ name: "Tabs", arg: '{\n\t"a": 1\n}\n', expect: "\t" },
				{ name: "CRLF line endings", arg: '{\r\n  "a": 1\r\n}\r\n', expect: "  " },
				{
					name: "Nested: shallowest wins",
					arg: '{\n  "a": {\n    "b": 1\n  }\n}\n',
					expect: "  ",
				},
			],
		},
		{
			name: "Falls back",
			tests: [
				{ name: "Missing file", args: [undefined], expect: "\t" },
				{ name: "Minified", args: ['{"a":1}'], expect: "\t" },
				{ name: "Empty file", args: [""], expect: "\t" },
				{ name: "Custom fallback", args: ['{"a":1}', "  "], expect: "  " },
			],
		},
	],
};
