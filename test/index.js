import utilTests from "./util/index.js";
import configTests from "./config/index.js";
import mapTests from "./map/index.js";
import hostTests from "./hosts.js";

export default {
	name: "All nudeps tests",
	tests: [utilTests, configTests, mapTests, hostTests],
};
