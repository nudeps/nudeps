(map => {
	let script = document.createElement("script");
	script.type = "importmap";
	script.textContent = JSON.stringify(map);
	document.currentScript.after(script);
})(
	/* importmap start */ {
		imports: {
			"foo/": "./test/",
		},
	} /* importmap end */,
);
