import modeResolution from "./mode-resolution.js";
import optionResolution from "./option-resolution.js";
import hardening from "./hardening.js";

export default {
	name: "config tests",
	tests: [modeResolution, optionResolution, hardening],
};
