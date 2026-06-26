import jspmOverridesTests from "./jspm-overrides.js";
import packagesTests from "./packages.js";
import readJSONTests from "./read-json.js";

export default {
	name: "util tests",
	tests: [jspmOverridesTests, packagesTests, readJSONTests],
};
