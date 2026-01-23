export default class ModulePath {
	nudeps = null;
	packages = [];
	parent = null;
	path = "";
	parts = [];
	base = [];
	filePath = "";

	static all = {};

	constructor (path, nudeps) {
		this.nudeps = nudeps;

		if (Array.isArray(path)) {
			this.path = path.join("/");
			this.parts = path;
		}
		else {
			this.path = path;
			this.parts = path.split("/");
		}

		let index = this.parts.indexOf("node_modules");

		if (index > -1) {
			this.base = this.parts.splice(0, index).join("/");

			while (this.parts[0] === "node_modules") {
				this.parts.shift();
				let isScoped = this.parts[0].startsWith("@");
				let packageName = this.parts.splice(0, isScoped ? 2 : 1).join("/");
				this.packages.push(packageName);
			}
		}

		this.filePath = this.parts.join("/") ?? "";

		this.parent = this.isNested
			? this.constructor.from([this.base, ...this.packages.slice(0, -1)], this.nudeps)
			: null;
	}

	get isNested () {
		return this.packages.length > 1;
	}

	get lockKey () {
		return this.packages.map(pkg => "node_modules/" + pkg).join("/");
	}

	get topLockKey () {
		return "node_modules/" + this.packages[0];
	}

	get version () {
		return this.nudeps.packages[this.lockKey]?.version;
	}

	get packageName () {
		return this.nudeps.packages[this.lockKey]?.name ?? this.packages.at(-1);
	}

	get localDir () {
		let versionSuffix = this.version ? "@" + this.version : "";
		return [this.nudeps.dir, this.packageName + versionSuffix].join("/");
	}

	get localParentDir () {}

	get localPath () {
		return [this.localDir, this.filePath].join("/");
	}

	get nodeDir () {
		return [this.base, this.lockKey].join("/");
	}

	get topNodeDir () {
		return [this.base, this.topLockKey].join("/");
	}

	toString () {
		return this.path;
	}

	static from (path, nudeps) {
		if (!this.all[path]) {
			this.all[path] = new ModulePath(path, nudeps);
		}
		return this.all[path];
	}
}
