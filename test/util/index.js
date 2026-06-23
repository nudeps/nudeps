import packagesTests from "./packages.js";
import clientDepsTests from "./client-dependencies.js";
import readJSONTests from "./read-json.js";

export default {
	name: "util tests",
	tests: [packagesTests, clientDepsTests, readJSONTests],
};
