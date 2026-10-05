import packagesTests from "./packages.js";
import readJSONTests from "./read-json.js";
import detectIndentTests from "./detect-indent.js";
import relativeURLTests from "./relative-url.js";

export default {
	name: "util tests",
	tests: [packagesTests, readJSONTests, detectIndentTests, relativeURLTests],
};
