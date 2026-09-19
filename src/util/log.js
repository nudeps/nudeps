/**
 * Logging, tagged so nudeps' output stays attributable among npm's own.
 */

export function info (...messages) {
	console.info("[nudeps]", ...messages);
}

export function warn (...messages) {
	console.warn("[nudeps]", ...messages);
}

export function error (...messages) {
	console.error("[nudeps]", ...messages);
}
