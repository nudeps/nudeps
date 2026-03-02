import { readJSONSync } from "../../src/util/fs.js";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

let __dirname = path.dirname(fileURLToPath(import.meta.url));
let tmpDir = path.join(__dirname, ".tmp");

export default {
	name: "readJSONSync",
	beforeAll () {
		mkdirSync(tmpDir, { recursive: true });
		writeFileSync(path.join(tmpDir, "valid.json"), '{"a": 1}');
		writeFileSync(path.join(tmpDir, "invalid.json"), "{bad");
	},
	afterAll () {
		rmSync(tmpDir, { recursive: true, force: true });
	},
	tests: [
		{
			name: "Valid file",
			run () {
				return readJSONSync(path.join(tmpDir, "valid.json"));
			},
			expect: { a: 1 },
		},
		{
			name: "Missing file throws ENOENT by default",
			run () {
				readJSONSync(path.join(tmpDir, "nope.json"));
			},
			throws: e => e.code === "ENOENT",
		},
		{
			name: "Invalid JSON throws ERR_INVALID_JSON by default",
			run () {
				readJSONSync(path.join(tmpDir, "invalid.json"));
			},
			throws: e => e.code === "ERR_INVALID_JSON" && e.cause instanceof SyntaxError,
		},
		{
			name: "Missing file returns undefined with optional",
			run () {
				return readJSONSync(path.join(tmpDir, "nope.json"), { optional: true });
			},
			expect: undefined,
		},
		{
			name: "Invalid JSON returns undefined with optional",
			run () {
				return readJSONSync(path.join(tmpDir, "invalid.json"), { optional: true });
			},
			expect: undefined,
		},
		{
			name: "Error message contains resolved path",
			run () {
				readJSONSync("./relative/nope.json");
			},
			throws: e => path.isAbsolute(e.message.replace("File not found: ", "")),
		},
	],
};
