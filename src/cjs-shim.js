// CJS shim
let modules = {};

function resolve (specifier, parentURL = cS.src) {
	for (let s in map.imports) {
		if (specifier === s) {
			return new URL(map.imports[s], parentURL).href;
		}
		if (s.endsWith("/") && specifier.startsWith(s)) {
			let target = map.imports[s] + specifier.slice(s.length);
			return new URL(target, parentURL).href;
		}
	}

	throw new Error(`Unknown specifier: ${specifier}`);
}

function require (specifier, parentURL) {
	let url = specifier;

	if (url.startsWith(".")) {
		url = new URL(url, parentURL ?? cS.src).href;
	}
	else if (!url.startsWith("https:")) {
		url = resolve(specifier, parentURL);
	}

	if (url in modules) {
		return modules[url];
	}

	// Sync XHR request
	const xhr = new XMLHttpRequest();
	xhr.open("GET", url, false);
	xhr.send();

	if (xhr.status < 200 || xhr.status >= 400) {
		throw new Error(`require(): Failed to fetch ${url} (HTTP ${xhr.status})`);
	}

	// Check content type
	let contentType = xhr.getResponseHeader("Content-Type");
	if (contentType && contentType.includes("application/json")) {
		let json;
		try {
			json = JSON.parse(xhr.responseText);
		}
		catch (e) {
			return;
		}

		return (modules[url] = json);
	}

	let module = { exports: {} };
	let __filename = url;
	let __dirname = new URL(".", url).href;
	let process = globalThis.process ?? { env: { NODE_ENV: "production" } };

	// Cache early to support cycles (Node-like behavior)
	modules[url] = module.exports;

	let source = [xhr.responseText, `//# sourceURL=${url}`].join("\n");
	let localRequire = s => require(s, url);

	// Node-style wrapper: keep `exports`/`module` function-scoped so closures work.
	new Function("exports", "require", "module", "__filename", "__dirname", "process", source)(
		module.exports,
		localRequire,
		module,
		__filename,
		__dirname,
		process,
	);

	return (modules[url] = module.exports);
}

globalThis.require ??= specifier => require(specifier, cS.src);
