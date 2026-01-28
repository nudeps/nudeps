# Nudeps

Your dependencies, naked.

This package introduces lightweight tooling as an alternative to bundlers.
It lets you use `npm install` as you normally would, and import dependencies via specifiers in the browser without a bundler or build step.
Yes, you read that right.

- ✅ **No watchers!** Nothing to remember to run before working on code
- ✅ **No transpilation or bundling** needed for either your code or your dependencies
- ✅ **Granular cache busting**, only for modules that change version
- ✅ **No additional client-side code** you need to run [^1]
- ✅ **Even CJS packages work!** (experimental)

[^1]: Except for CJS packages, which require a shim that is automatically included.

Try it out in the [demos repository](https://github.com/nudeps/nudeps-demos).

For background, see [Web dependencies are broken. Can we fix them?](https://lea.verou.me/blog/2026/web-deps/).

## Contents

1. [How does it work?](#how-does-it-work)
2. [Nudeps vs JSPM](#nudeps-vs-jspm)
	1. [Do I need nudeps or JSPM?](#do-i-need-nudeps-or-jspm)
3. [Current limitations](#current-limitations)
4. [Installation](#installation)
	1. [Local installation](#local-installation)
	2. [Global installation](#global-installation)
	3. [Automatically run nudeps when dependencies change](#automatically-run-nudeps-when-dependencies-change)
5. [Config options](#config-options)
	1. [Restricting which files are deployed from dependencies](#restricting-which-files-are-deployed-from-dependencies)
6. [Commands](#commands)
	1. [`nudeps`](#nudeps-1)
	2. [`nudeps --prune`](#nudeps---prune)
	3. [`nudeps --init`](#nudeps---init)
7. [FAQ](#faq)
	1. [Which browsers are supported?](#which-browsers-are-supported)
	2. [Does this support pnpm/bun/yarn/etc.?](#does-this-support-pnpmbunyarnetc)
	3. [Why does it add the version number to the directory name?](#why-does-it-add-the-version-number-to-the-directory-name)
	4. [Do I need to add `.nudeps`, `client_modules` and `importmap.js` to my `.gitignore`?](#do-i-need-to-add-nudeps-client_modules-and-importmapjs-to-my-gitignore)
	5. [Why doesn't Nudeps have an option to add integrity hashes to the import map?](#why-doesnt-nudeps-have-an-option-to-add-integrity-hashes-to-the-import-map)
	6. [How are CJS (CommonJS) packages handled?](#how-are-cjs-commonjs-packages-handled)
8. [Troubleshooting](#troubleshooting)
	1. [Getting an error about a specifier failing to resolve](#getting-an-error-about-a-specifier-failing-to-resolve)
	2. [Package assumes a bundler is being used](#package-assumes-a-bundler-is-being-used)
	3. [Packages that use extension-less paths](#packages-that-use-extension-less-paths)

## How does it work?

You run `nudeps install` once to initialize the project.
That’s it.
You can then forget about it, it will run automatically whenever you install or uninstall packages.
Unless you need to transpile your JS for other reasons, you can write JS that just runs, no transpilation needed.

Instead of forcing you to use a CDN, Nudeps copies your dependencies to a **local directory** you specify (`./client_modules` by default), adds versions to directory names for **cache busting**, and generates an **import map** that maps specifiers to these local paths.
For example, `lit` may be mapped to `"./client_modules/lit@3.3.2/index.js"`.

All it takes to use these definitions is to include the `importmap.js` file in your HTML before any modules are loaded:

```html
<script src="importmap.js"></script>
```

You can include that one line of HTML either manually or via your templating system of choice.
You can see an example of what such a file looks like at https://github.com/nudeps/nudeps-demos/blob/main/floating-ui/importmap.js

You then install and uninstall dependencies as needed and use them straight away, and both the import map and copied dependencies will be automatically updated.
No, without you having to remember to run anything before or after.

If you want, you can periodically run `nudeps --prune` to subset the copied dependencies and import map to only those used by your own package entry points.

## Nudeps vs JSPM

Nudeps is actually implemented as an opinionated wrapper over the excellent [JSPM Generator](https://jspm.org/), which handles a lot of the heavy lifting around import map generation.
Unlike JSPM, Nudeps does not aim to cover all possible use cases.
Instead, it aims to cover a subset of use cases with the best DX possible.

### Do I need nudeps or JSPM?

JSPM has paved the way in managing import maps that let you use specifiers in the browser and its Generator module doing a lot of the heavy lifting here.

However:

- It basically forces you into using a CDN. While there is a `nodemodules` provider, it is only meant for local development and does not do any cache busting.
  However, CDNs are generally considered insecure, and introduce an additional point of failure in terms of reliability.
  Nudeps copies only the dependencies you use in a directory you specify and adds version numbers to directory names so that you get the same cache busting behavior as you would with a CDN, but in your own domain.
- While subsetting modules to only those you actually use is a good idea, it forces you to run a build process before working on code, which is a hassle and error-prone, especially when working with beginners.
  Nudeps separates this subsetting into a separate step ("pruning") that you can run separately, as an optimization. This allows it to only run when dependencies change, rather than continuously during development.

With nudeps, your workflow is basically:

- `npm install` or `npm uninstall` as needed
- Just use specifiers in your code
- Nothing more to do, no build process to run, everything just works.

Here is a handy table to compare the two:

| Feature                                                                 | nudeps | JSPM      |
| ----------------------------------------------------------------------- | ------ | --------- |
| Use specifiers both in your own code, and in code you distribute.       | ✅     | ✅        |
| Manages copying the right dependencies out of `node_modules`            | ✅     | ❌        |
| Use dependencies without having to transpile your _own_ code.           | ✅     | ✅        |
| No "browser bundle" nonsense: common transitive dependencies are shared | ✅     | ✅        |
| Separate files are kept separate and cached separately.                 | ✅     | ✅        |
| `npm link` still works                                                  | ✅     | ✅        |
| No build process to remember to run before working on code              | ✅     | ❌        |
| Granular cache busting, only for modules that change version            | ✅     | CDNs only |
| Import map automatically updated as you install packages                | ✅     | ❌        |
| Supports CDNs like unpkg, jsdelivr, etc.                                | ❌     | ✅        |
| Self-host dependencies                                                  | ✅     | ❌        |

## Current limitations

- Directly installing repos as dependencies does not work yet. ([#23](https://github.com/nudeps/nudeps/issues/23))
- Non-prefix wildcard exports (e.g. `/*` to `./dist/*.ts.js`) are only added to import map when actually used ([#25](https://github.com/nudeps/nudeps/issues/25))
- Specifiers will not work in web workers ([#19](https://github.com/nudeps/nudeps/issues/19))

## Installation

You can install nudeps as a devDependency, locally in each project or globally to have it available on every project.

### Local installation

This can be useful for signaling to collaborators that nudeps is required to work on the project.

```bash
npm install nudeps -D
```

### Global installation

You can also install Nudeps globally:

```bash
npm install nudeps -gD
```

Then, whenever you want to initialize for a given project, just run `nudeps` in its root directory.
It will automatically detect that it has not run before and initialize.

### Automatically run nudeps when dependencies change

This is essential, otherwise you’d need to manually run `nudeps` whenever you install or uninstall a dependency.

Either run `nudeps install` which will do this automatically, or add a `dependencies` script manually to your `package.json`:

```json
{
	"name": "my-project",
	"scripts": {
		"dependencies": "npx nudeps"
	}
}
```

> [!TIP]
> If you have another `dependencies` script, you can use `predependencies` to run `nudeps` before it or `postdependencies` to run `nudeps` after it.

Then, to use the import map in your app, include this script in your HTML before any modules are loaded, either manually or via your templating system of choice:

```html
<script src="/importmap.js"></script>
```

> [!IMPORTANT]
> This script needs to be included before any module scripts are loaded or it won't work!

## Config options

Each of the following options is available either as a config file key, or a command line option (e.g. `foo` would be `--foo`).
Some command line options allow for a shorthand one letter syntax, which is listed after a slash.

| Option               | Config file key | CLI option  | CLI short flag | Default            | Description                                                                                                                                                                                                                                                                  |
| -------------------- | --------------- | ----------- | -------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Directory            | `dir`           | `--dir`     | `-d`           | `./client_modules` | Directory to copy deployed dependencies to, relative to project root. It will be created if it does not exist. It is assumed that Nudeps owns this directory, do not use a directory path that you use for other things.                                                     |
| Import map           | `map`           | `--map`     | `-m`           | `importmap.js`     | File path for import map injection script, relative to project root. Nudeps needs to be able to own this file, do not input a file you use for other things too.                                                                                                             |
| Prune                | `prune`         | `--prune`   |                | `false`            | Whether to subset only to specifiers used by the package entry points (`true`), or include all direct dependencies anyway.                                                                                                                                                   |
| Ignore files         | `ignore`        | -           | -              | See below          | Any files to exclude from being copied to the target directory. See below for more details.                                                                                                                                                                                  |
| Exclude              | `exclude`       | `--exclude` | `-e`           | `[]`               | Any packages to exclude from import map even though they appear in `dependencies`. Useful for server-side dependencies. When providing via the command line option, comma-separate and do not include any spaces. They will still be included if actively used in your code. |
| External config file | -               | `--config`  | `-c`           | `nudeps.js`        | File path for nudeps configuration, relative to project root. It should export an object literal with the configuration options as keys.                                                                                                                                     |
| Overrides            | `overrides`     | -           | -              | `{}`               | Overrides for the import map, using `./node_modules/` paths. Set a key to `undefined` to remove it from the map.                                                                                                                                                             |
| CommonJS             | `cjs`           | `--cjs`     | -              | `true`             | Whether to add a CommonJS shim to the import if any CJS packages are detected. Setting to `false` will omit both the shim and these packages from the import map.                                                                                                            |

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

## Commands

### `nudeps`

Initialize or update as needed.
Takes care of

- Copying dependencies to the target directory
- Generating a new import map

### `nudeps --prune`

Subset copied dependencies and import map to only those used by your own package entry points.
Subsequent runs of `nudeps` will respect previously pruned dependencies (unless you use `--init`).
This allows you to use dependencies immediately as they are added, without having to continuously watch all your JS files, and periodically run `nudeps --prune` to subset.

You can set `prune: true` in your config file to always prune dependencies but then you will need to re-run it when your code changes.

### `nudeps --init`

Force initialization, even if nudeps has already run.

## FAQ

### Which browsers are supported?

Nudeps works in pretty much every browser that supports import maps, which is [all of them](https://caniuse.com/import-maps) at this point, including:

- Chrome **89+**
- Safari **16.4+**
- Firefox **108+**

### Does this support pnpm/bun/yarn/etc.?

At the moment, we’re focusing on nailing the best DX possible, and to let us focus on that, we're cutting scope by only supporting npm for now.
However, Nudeps should however work with any other package managers that follow similar conventions in terms of:

- `node_modules` directory structure
- `package-lock.json` file format
- `package.json` file format

You're welcome to contribute support for other package managers, but please let me know first so we can discuss the best approach.

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
For example, as of this writing, using `vue` out of the box will fail with an error about `process` not being available.

There are two ways to fix this:

- Use the package's browser bundle through the `overrides` option. This is usually not advisable because it inlines dependencies that other packages may be using too, but sometimes it's the best way forwards. You can see an example of this in the [Vue demo](https://github.com/nudeps/nudeps-demos/tree/main/vue).
- Stub NodeJS objects like `process`. This can work if the surface area is limited, but it can quickly turn into a game of whack-a-mole. Additionally, it can cause bugs in other packages that depend on the presence of these objects to _detect_ NodeJS.

### Packages that use extension-less paths

Some packages use extension-less paths even for their own imports, e.g. `./foo/bar` instead of `./foo/bar.js`.
While this doesn't usually make it to the files they distribute, there are a few exceptions.
Because these are not actual specifiers, import maps will not help here.
However, since the browser will see these as URLs, you can take advantage of whatever URL rewriting capabilities your server has and simply rewrite not-found URLs in that directory to their corresponding `.js` paths.
For example, using a [Netlify `_redirects` file](https://docs.netlify.com/routing/redirects/redirect-options/) this may look like this:

```
/client_modules/*  /client_modules/:splat.js 301
```
