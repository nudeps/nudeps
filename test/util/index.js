import jspmOverridesTests from "./jspm-overrides.js";
import packagesTests from "./packages.js";
import readJSONTests from "./read-json.js";
import detectIndentTests from "./detect-indent.js";
import relativeURLTests from "./relative-url.js";

export default {
	name: "util tests",
	tests: [jspmOverridesTests, packagesTests, readJSONTests, detectIndentTests, relativeURLTests],
};
