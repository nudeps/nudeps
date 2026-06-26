<div align="center">
  <a href="https://github.com/nudeps/nudeps">
    <img width="200" height="200" src="https://nudeps.dev/logo.svg">
  </a>

<h1><img src="https://nudeps.dev/wordmark.svg" alt="nudeps" width="250"></h1>

**Web dependencies, _naked_.**

</div>

Nudeps is a new, **ultra-lightweight end-to-end dependency management system**, intended to make **bundler-free, local-first** workflows not just _possible_, but actually _pleasant_.

It lets you use `npm install`/`npm uninstall` to manage client-side dependencies, and then use them via plain specifiers in your code (e.g. `import foo from "foo"`) without a bundler or build step.

It works by copying a subset of your dependencies to a local directory and generating an [import map](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script/type/importmap) that maps specifiers to these local paths.
Then, the import map is automatically updated whenever dependencies change, through NPM hooks.

<details>
<summary><strong>Example usage scenario: VueJS app</strong></summary>

Suppose you want to use e.g. [VueJS](https://vuejs.org/) for a simple web app.

You could start by creating a new directory for your app with the following files:

```
my-app/
├── index.html
└── index.js
```

`index.html` might be something like this:

```html
<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>My App</title>
	<script src="importmap.js"></script>
	<script type="module" src="index.js"></script>
</head>
<body>
	<h1>My App</h1>
</body>
</html>
```

Install Nudeps and add the necessary NPM hooks to your `package.json` by running:

```bash
npx nudeps install
```

Then you can install dependencies and they would Just Work™, starting with VueJS:

```bash
npm install vue
```

Now you can write `import { createApp } from "vue"` in your `index.js` file and it just works!

You can keep installing and uninstalling dependencies as needed, and use them immediately in your code — the import map will be updated automatically and you don’t have to lift a finger!

</details>

Features:

- ✅ **No transpilation or bundling needed** for either your code or your dependencies (already transpiling? No problem!)
- ✅ **Granular cache busting**: When a module is updated, it is automatically updated in the browser cache, and that does not affect any other modules
- ✅ **Local-first workflow**, no external requests, no CDN required, no additional points of failure
- ✅ **Automatically updated when dependencies change** No need to start anything before you can edit files — everything just works.
- ✅ **No additional client-side code** to run (unless you have CJS packages [^1])
- ✅ **Nice URLs for non-JS resources** (CSS, images, icons, etc.) — because the Web is not just JS

Even edge cases work:

- ✅ Dynamic `import()`
- ✅ `import.meta.resolve()`
- ✅ CJS packages (experimental)
- ✅ Local packages (`npm install ../foo`)
- ✅ Git dependencies (`npm install git+https://github.com/foo/bar.git`)
- ✅ npm aliases (`npm install vue2@npm:vue@2`)

[^1]: Except for CJS packages, which require a shim that is automatically included.

Try it out in the [demos repository](https://github.com/nudeps/nudeps-demos).

For background, see these blog posts:

- [Web dependencies are broken. Can we fix them?](https://lea.verou.me/blog/2026/web-deps/).
- [External import maps, today!](https://lea.verou.me/blog/2026/external-import-maps-today/)
- [Introducing Nudeps: Web dependencies, naked!](https://lea.verou.me/blog/2026/nudeps/) (upcoming)

## Contents

1. [Installation \& Usage](#installation--usage)
2. [How does it work?](#how-does-it-work)
3. [Do I need nudeps or JSPM?](#do-i-need-nudeps-or-jspm)
4. [Limitations](#limitations)
5. [Config options](#config-options)
    1. [Restricting which files are deployed from dependencies](#restricting-which-files-are-deployed-from-dependencies)
    2. [Importing non-JS resources: Unversioned aliases](#importing-non-js-resources-unversioned-aliases)
    3. [Modes](#modes)
    4. [Pruning (`nudeps --prune`)](#pruning-nudeps---prune)
    5. [Force initialization (`nudeps --init`)](#force-initialization-nudeps---init)
6. [Local dependencies (via `npm install ../other-repo`)](#local-dependencies-via-npm-install-other-repo)
    1. [Registration](#registration)
    2. [Propagation](#propagation)
7. [Programmatic API](#programmatic-api)
8. [FAQ](#faq)
    1. [Which browsers are supported?](#which-browsers-are-supported)
    2. [Does this support pnpm/bun/yarn/etc.?](#does-this-support-pnpmbunyarnetc)
    3. [Why does it add the version number to the directory name?](#why-does-it-add-the-version-number-to-the-directory-name)
    4. [Do I need to add `.nudeps`, `client_modules` and `importmap.js` to my `.gitignore`?](#do-i-need-to-add-nudeps-client_modules-and-importmapjs-to-my-gitignore)
    5. [Why doesn't Nudeps have an option to add integrity hashes to the import map?](#why-doesnt-nudeps-have-an-option-to-add-integrity-hashes-to-the-import-map)
    6. [How are CJS (CommonJS) packages handled?](#how-are-cjs-commonjs-packages-handled)
9. [Troubleshooting](#troubleshooting)
    1. [Getting an error about a specifier failing to resolve](#getting-an-error-about-a-specifier-failing-to-resolve)
    2. [Package assumes a bundler is being used](#package-assumes-a-bundler-is-being-used)
    3. [Packages that use extension-less paths](#packages-that-use-extension-less-paths)

## Installation & Usage

To install Nudeps on a project and initialize it, run:

```bash
npx nudeps install
```

This will add a `dependencies` (or `predependencies`, `postdependencies` if `dependencies` is taken) script to your `package.json` that will run `nudeps` automatically whenever you install or uninstall packages.
It will also run Nudeps for you, which will copy your dependencies (and their transitive dependencies) to the client modules directory (as `./client_modules` by default) and generate an [import map](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script/type/importmap) (as `importmap.js` by default).

You can see an example of what such a file looks like at https://github.com/nudeps/nudeps-demos/blob/main/floating-ui/importmap.js
(you can also browse the other demos in the [nudeps-demos repository](https://github.com/nudeps/nudeps-demos))

> [!NOTE]
> Normally you should avoid committing your import map to version control as it's a build artifact, but it is included there for demonstration purposes.

To use the import map in your app, include it in a classic (non-module) `<script>` element, before any modules are loaded, either manually or via your templating system of choice:

```html
<script src="/importmap.js"></script>
```

> [!IMPORTANT]
> To maximize compatibility, this script needs to be included **before any module scripts are loaded, and must be included as a regular script, not a module script.**
> If you want to include it as `<script type="module" src="importmap.js">` instead, set the `module` option to `true` in your nudeps config.
> Please note that as of March 2026, this will _dramatically_ reduce browser support and is not recommended.

Once you do that, you can just **forget about Nudeps and go about your business**, using `npm install` and `npm uninstall` for dependencies as you normally would.
If something seems off, you can run `npx nudeps` explicitly, but most of the time things should Just Work™.

### AI coding assistants

Nudeps ships with a [`SKILL.md`](SKILL.md) — a comprehensive reference that teaches AI coding agents how to work with nudeps correctly (lifecycle hooks, generated artifacts, CJS handling, common mistakes, etc.).

The easiest way to install it is via the [`skills`](https://github.com/nicepkg/skills) CLI, which supports 45+ agents including Claude Code, Cursor, and Copilot:

```bash
npx skills add nudeps/nudeps
```

The skill file is also available at `node_modules/nudeps/SKILL.md` after installation.

## How does it work?

Nudeps copies your dependencies to a **local directory** you specify (`./client_modules` by default), adds versions to directory names for **cache busting** just like a CDN, generates an [**import map**](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script/type/importmap) that maps specifiers to these local paths, and an injection script that injects the import map into any HTML page.
For example, `lit` may be mapped to `"./client_modules/lit@3.3.2/index.js"`.
The injection script rebases each address to an absolute URL at runtime, against its own location rather than the page's — so a single import map resolves correctly from every page of a multi-page site, at any directory depth.

It then optimistically adds your direct dependencies to your import map, so that you can use them straight away.
In production (or if you use the `prune` option), it will subset the import map to only include the dependencies you actually use.

## Do I need nudeps or JSPM?

[JSPM](https://jspm.org/) paved the way in managing import maps that let you use specifiers in the browser.
Nudeps actually uses the excellent [JSPM Generator](https://jspm.org/docs/generator/) under the hood, which handles a lot of the heavy lifting around tracing and import map generation.

The main value-add of nudeps over JSPM is:

- Letting you **host your own dependencies** instead of relying on a CDN, selectively and with the same cache busting behavior as a CDN.
- Because it takes a different approach to handling which dependencies are installed, it does **not require a watcher** — it just runs during certain npm hooks and that's enough.
- It also takes care of making non-JS imports more palatable, through [aliases](#importing-non-js-resources-unversioned-aliases)

If you’re ok with using a CDN for your dependencies and don't need any of these features, JSPM is a great choice.

Here is a handy table to compare the two:

| Feature                                                               | nudeps | JSPM      |
| --------------------------------------------------------------------- | ------ | --------- |
| Use specifiers both in your own code, and in code you distribute.     | ✅     | ✅        |
| Self-host dependencies                                                | ✅     | ❌        |
| Use dependencies without having to transpile your _own_ code.         | ✅     | ✅        |
| Shared transitive dependencies                                        | ✅     | ✅        |
| `npm link` still works                                                | ✅     | ✅        |
| No build process to remember to run before working on code            | ✅     | ❌        |
| Supports CDNs like unpkg, jsdelivr, etc.                              | ❌     | ✅        |
| Granular cache busting                                                | ✅     | CDNs only |
| Nice URLs for resources that can't use specifiers (CSS, images, etc.) | ✅     | ❌        |

## Limitations

- Specifiers will not work in web workers ([#19](https://github.com/nudeps/nudeps/issues/19)). This is a platform limitation, and is not specific to nudeps.

## Config options

Most options are available either as a config file key, or a command line option (e.g. `foo` would be `--foo`), though their CLI version may support a more limited syntax.
Some command line options also allow for a shorthand one letter syntax (e.g. `-d foo` instead of `--dir=foo`) which is listed under "CLI short flag".

| Option                  | Config file key          | CLI option  | CLI short flag | Default            | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------- | ------------------------ | ----------- | -------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mode                    | `mode`                   | `--mode`    | `-m`           | -                  | Activate a mode preset that sets multiple option defaults at once. Built-in modes: `dev`, `prod`. See [Modes](#modes) below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Directory               | `dir`                    | `--dir`     | `-d`           | `./client_modules` | Directory to copy deployed dependencies to, relative to project root. It will be created if it does not exist. It is assumed that Nudeps owns this directory, do not use a directory path that you use for other things.                                                                                                                                                                                                                                                                                                                                                                                                    |
| Import map              | `map`                    | `--map`     | `-o`           | `importmap.js`     | File path for import map injection script, relative to project root. Nudeps needs to be able to own this file, do not input a file you use for other things too.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Prune                   | `prune`                  | `--prune`   |                | `false`            | Whether to subset only to specifiers used by the package entry points (`true`), or include all direct dependencies anyway.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Ignore files            | `ignore`                 | -           | -              | See below          | Any files to exclude from being copied to the target directory. See below for more details.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Exclude                 | `exclude`                | `--exclude` | `-e`           | `[]`               | Any packages to exclude from import map even though they appear in `dependencies`. Useful for server-side dependencies. When providing via the command line option, comma-separate and do not include any spaces. They will still be included if actively used in your code.                                                                                                                                                                                                                                                                                                                                                |
| Additional dependencies | `additionalDependencies` | -           | -              | `[]`               | Extra packages to add to the import map beyond your `dependencies` — e.g. a tool (such as a static site generator) calling nudeps [programmatically](#programmatic-api) can inject its own client-side libraries. Treated exactly like `dependencies` (installed unless pruned, subject to `exclude`); a no-op for anything already in `dependencies`.                                                                                                                                                                                                                                                                      |
| External config file    | -                        | `--config`  | `-c`           | `nudeps.js`        | File path for nudeps configuration, relative to project root. It should export an object literal with the configuration options as keys.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Overrides               | `overrides`              | -           | -              | `{}`               | Overrides for the import map, using `./node_modules/` paths. Set a key to `undefined` to remove it from the map.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Module                  | `module`                 | `--module`  | -              | `false`            | Set to `true` if the import map script will be loaded as `<script type="module">`. Please note that **this will reduce browser support**, as certain browsers do not support injecting import maps after any module has started loading.                                                                                                                                                                                                                                                                                                                                                                                    |
| CommonJS                | `cjs`                    | `--cjs`     | -              | `true`             | Whether to add a CommonJS shim to the import if any CJS packages are detected. Setting to `false` will omit both the shim and these packages from the import map.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Combine subpaths        | `combineSubpaths`        | -           | -              | `false`            | Whether to collapse multiple subpath entries for the same package into a single trailing-slash prefix (e.g. `"pkg/"` instead of individual `"pkg/a"`, `"pkg/b"` entries). `false` keeps every used subpath explicit; `true` collapses within scopes; `"both"` also collapses top-level imports. Combining subpaths can produce signiicantly smaller import maps, but is a lossy process, as it can expose specifiers that would not have resolved to anything in the original package. Corresponds to the [`combineSubpaths` option of `@jspm/generator`](https://jspm.org/docs/generator/interfaces/GeneratorOptions.html) |
| Terse import map        | `terse`                  | `--terse`   | -              | `false`            | Terser import map injection script (compact JSON, no error checks, reduced whitespace). Enabled by default in `prod` mode.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Alias                   | `alias`                  | `--alias`   | -              | `true`             | Create unversioned symlinks in `client_modules` pointing to versioned directories. Useful for stable URLs to package assets (CSS, images, etc.). See [Aliases](#aliases) below.                                                                                                                                                                                                                                                                                                                                                                                                                                             |

### Restricting which files are deployed from dependencies

By default, Nudeps will copy everything in each package except for the following:

- `readme` or `README` files with any extension
- Files and directories starting with a dot
- `package.json`, `package-lock.json`, `pnpm-lock.json` files at the top level of any package

**Why not just restrict to copying `*.js` files by default?**
Because this allows dependencies to fetch other files dynamically, e.g. stylesheets, images, data files, etc.
This is particularly important for UI libraries, component libraries, etc.
Since files are only fetched when used, this does not impact actual bandwidth usage.
And if you’re trusting a package to run JS in your domain anyway, the additional risk from copying its entire package directory is tiny.

That said, there are cases where you _know_ you won’t need certain files.
You can add additional globs (per Node’s native glob syntax) to be included or excluded by providing globs to the `ignore` option.
Its value can be either an array or a singular value.
Each glob can be provided as a raw string (glob to exclude) or an object with an `include` or `exclude` property.
The values of these properties can also be arrays of strings or objects.
Globs are relative to the package root.

The semantics are similar to a `.gitignore` file, meaning that negative globs can only undo globs that precede them.

For example:

- To include `package.json` files you'd use `ignore: { include: "package.json" }`.
- To only copy `*.js` files and nothing else you'd use `ignore: [{ exclude: "**/*" }, { include: "**/*.js" } ]`. (but see above why this is not recommended)

To restrict rules to specific packages, you can provide the rule as an object and add one or more (as an array) package names via the `packageName` property.

### Importing non-JS resources: Unversioned aliases

While the import map handles JavaScript specifier resolution, you may need to reference package files directly by URL — for example, CSS files, images, or other assets.
Because package directories include version numbers (e.g., `client_modules/open-props@2.0.4/`), these URLs break every time a dependency is updated.

The `alias` option solves this by creating unversioned symlinks alongside the versioned directories.
For example, `client_modules/open-props` will point to `client_modules/open-props@2.0.4`.

This lets you use stable paths like `client_modules/open-props/open-props.min.css` in your HTML and CSS.

By default, `alias` is `true`, which creates an unversioned symlink for every package using its install name (generally the same as the package name, except for [npm aliases](https://docs.npmjs.com/cli/v11/using-npm/package-spec#aliases)).
Set `alias: false` to opt out entirely.

The `alias` option supports several forms:

**Boolean** to set globally for all packages. Note that `alias: true` will _only_ create aliases for direct dependencies, not transitive dependencies. If you also want to alias transitive dependencies, you need to use one of the more granular forms.

**String** — alias a single package by name:

```js
alias: "open-props";
```

**Function** — dynamically determine based on package metadata.
For example, to alias every package to its unversioned name (even transitive dependencies, which are not included by `alias: true`), you can use:

```js
alias: ({ installName }) => installName;
```

**Array** — specify a list of packages to alias:

```js
alias: ["open-props", "tailwindcss"];
```

**Object** — map package names to custom alias paths:

```js
alias: {
	"open-props": "open-props",
	"tailwindcss": "tw",
}
```

Functions can also be used as object values for per-package logic:

```js
alias: {
	"open-props": ({version}) => `open-props-v${version.split(".")[0]}`,
}
```

When an alias is removed from the config (or its package is uninstalled), the symlink is automatically cleaned up on the next run.

> **npm aliases:** When using npm aliases (e.g. `npm install my-props@npm:open-props`), string and object forms match against both the install name (`my-props`) and the real package name (`open-props`), with install name taking priority in object lookups.
> Function forms receive both as `{ packageName, version, installName, isExternal }`, letting you distinguish multiple installs of the same package.

### Modes

Modes let you switch between sets of option defaults with a single flag. Two modes are built in:

| Mode   | Defaults                                       |
| ------ | ---------------------------------------------- |
| `dev`  | `symlink: true`                                |
| `prod` | `symlink: false`, `prune: true`, `terse: true` |

Use a mode from the CLI:

```bash
npx nudeps -m dev
npx nudeps --mode=prod
```

Or set it in your config file:

```js
export default {
	mode: "dev",
};
```

**Priority:** CLI args override config file values, which override mode defaults, which override hard defaults.
For example, `npx nudeps -m prod --prune=false` will use `prod` defaults but keep `prune` off.

#### Custom modes

You can define your own modes via the `modes` key in the config file. Custom modes are merged with the built-in ones (and can override them):

```js
export default {
	modes: {
		staging: {
			symlink: false,
			prune: false,
		},
	},
};
```

You can now run `npx nudeps -m staging` to use these defaults.

Modes can extend other modes by including a `mode` key. The child mode inherits all parent defaults and can override individual values:

```js
export default {
	modes: {
		staging: {
			// inherits prod's symlink: false, overrides prune
			mode: "prod",
			prune: false,
		},
	},
};
```

This also works for overriding built-in modes — use the same name to extend the built-in with your own defaults:

```js
export default {
	modes: {
		prod: {
			mode: "prod", // extends built-in prod
			prune: false, // but disables pruning
		},
	},
};
```

If an unknown mode is specified, a warning is printed listing the available modes.

### Pruning (`nudeps --prune`)

Subset copied dependencies and import map to only those used by your own package entry points.
Subsequent runs of `nudeps` will respect previously pruned dependencies (unless you use `--init`).
This allows you to use dependencies immediately as they are added, without having to continuously watch all your JS files, and periodically run `nudeps --prune` to subset.

You can set `prune: true` in your config file to always prune dependencies but then you will need to re-run it when your code changes.

### Force initialization (`nudeps --init`)

Force initialization, even if nudeps has already run.
Note that this also clears the list of local dependents (see below). They will re-register the next time they run nudeps.

## Local dependencies (via `npm install ../other-repo`)

When you have local dependencies (installed via `npm install ../other-repo`), nudeps automatically handles propagation between them, but there are a few things you need to know about it.

- You need Nudeps on both sides of the dependency for things to work
- Instead of copying `other-repo` to `client_modules/other-repo@<version>` by default it creates a symlink. You can tweak the `symlink` option to change this.
- Since the npm `dependencies` hook does not fire when the dependencies of `other-repo` change (see npm bug [#8984](https://github.com/npm/cli/issues/8984)), Nudeps on `other-repo` will run `npm run dependencies --if-present` in its own dependencies to trigger nudeps in them.

### Registration

Each time nudeps runs, it registers itself as a dependent of each of its local dependencies by writing its relative path to the dep's `.nudeps/local-dependents.json`.
If a local dependency doesn't have nudeps installed, a warning is printed suggesting you run `npx nudeps install` there.

### Propagation

When nudeps detects that the generated import map has actually changed (content differs from the file on disk), it reads `.nudeps/local-dependents.json` and runs `npx nudeps` in each listed dependent.
This ensures that when package B's dependencies change, any repo A that depends on B locally gets its import map updated automatically.

Circular local dependencies (A depends on B and B depends on A) are handled naturally: propagation only triggers when the map content changes, so cycles terminate once the maps converge.

## Programmatic API

You can use the programmatic API to call nudeps from another script:

```js
import nudeps from "nudeps";
await nudeps({ prune: true });
```

A tool that generates sites (e.g. a static site generator) can use `additionalDependencies` to inject its own client-side libraries into the consumer's import map, even though they are only `devDependencies` of the tool and not declared in the consumer's `dependencies`:

```js
import nudeps from "nudeps";
await nudeps({ additionalDependencies: ["my-widget", "another-lib"] });
```

## FAQ

### Which browsers are supported?

When the import map injection script is included as a non-module script before any module scripts are loaded, Nudeps works in pretty much every browser that supports import maps, which is [all of them](https://caniuse.com/import-maps) at this point, including:

- Chrome **89+**
- Safari **16.4+**
- Firefox **108+**

### Does this support pnpm/bun/yarn/etc.?

At the moment, we’re focusing on nailing the best DX possible, and to let us focus on that, we're cutting scope by only supporting npm for now.
Please open an issue if lack of support for your package manager is a blocker for you and add it below:

- [pnpm](https://github.com/nudeps/nudeps/issues/13)

If there is an existing issue for your package manager, please upvote it.

### Why does it add the version number to the directory name?

Because this allows you to get the same cache busting behavior as you would with a CDN, but in your own domain.
It also allows us to flatten dependencies to get better caching behavior: when you upgrade a dependency, its own dependencies remain cached by the browser unless _they_ also change version.

### Do I need to add `.nudeps`, `client_modules` and `importmap.js` to my `.gitignore`?

This is up to you.

- `.nudeps` and `client_modules` include local `.gitignore` files that prevent you from accidentally committing paths from them, but you may want to gitignore them at the top level so that you don't see them in your IDE.
- Whether you gitignore `importmap.js` is up to you. On one hand it's a generated file, and these generally should not be committed, on the other hand it can help track changes to dependencies in a compact way.

### Why doesn't Nudeps have an option to add integrity hashes to the import map?

The purpose of integrity hashes is to guard against compromise in resources you don't control, such as public CDNs.
When using Nudeps you host your own dependencies, so that is not necessary, and would unnecessarily double the size of your import map.
However, if we later decide there is a need for this,[the PR is already written](https://github.com/nudeps/nudeps/pull/5).

### How are CJS (CommonJS) packages handled?

When CJS packages are detected, [`cjs-browser-shim`](https://npmjs.com/package/cjs-browser-shim) is automatically included.
This is a tiny shim that makes `require()` work in the browser, both for relative paths and specifiers, allowing such dependencies to work out of the box.
Note that you would need to import such dependencies using `require()` in your code, like so:

```js
import { require } from "cjs-browser-shim";
const { createElement } = require("react");
```

You can see a demo of this in [`nudeps-demos/react`](https://github.com/nudeps/nudeps-demos/tree/main/react).

To disable this, set the `cjs` option to `false` and both these packages and the CJS shim will be omitted from the import map.

## Troubleshooting

While most packages should work fine, some packages make certain over-reaching assumptions about the environment they are running in.

### Getting an error about a specifier failing to resolve

There are a few cases where not all specifiers supported by a package can be detected upfront, and are only added when actually used in your code.
This is not frequent enough to warrant continuously running a watcher for every edit, but it can happen occassionally (e.g. see [#25](https://github.com/nudeps/nudeps/issues/25)).

Before investigating further:

1. Make sure your entry points are declared correctly in your `package.json`
2. Run `npx nudeps`

### Package assumes a bundler is being used

Some packages don't just use specifiers — they actively assume that if they can use specifiers, it _must_ mean that a bundler is being used and that the environment is NodeJS or similar.
For popular packages, we use [JSPM’s override registry](https://github.com/jspm/overrides) but for less well-known packages, you may need to use a custom override through the `overrides` option.

Another option is to stub NodeJS objects like `process`.
This can work if the surface area is limited, but it can quickly turn into a game of whack-a-mole. Additionally, it can cause bugs in other packages that depend on the presence of these objects to _detect_ NodeJS.

### Packages that use extension-less paths

Some packages use extension-less paths even for their own imports, e.g. `./foo/bar` instead of `./foo/bar.js`.
While this doesn't usually make it to the files they distribute, there are a few exceptions.
Because these are not actual specifiers, import maps will not help here.
However, since the browser will see these as URLs, you can take advantage of whatever URL rewriting capabilities your server has and simply rewrite not-found URLs in that directory to their corresponding `.js` paths.
For example, using a [Netlify `_redirects` file](https://docs.netlify.com/routing/redirects/redirect-options/) this may look like this:

```
/client_modules/*  /client_modules/:splat.js 301
```
