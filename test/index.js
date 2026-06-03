import utilTests from "./util/index.js";
import configTests from "./config/index.js";
import seedAliasTests from "./seed-aliases.js";

export default {
	name: "All nudeps tests",
	tests: [utilTests, configTests, seedAliasTests],
};
