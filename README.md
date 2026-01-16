# NuDeps

Your dependencies, naked.

For background, see [Web dependencies are broken. Can we fix them?](https://lea.verou.me/blog/2026/web-deps/).
This package introduces lightweight tooling as an alternative to bundlers.
It lets you use specifiers in the browser with no traditional build tools, meaning:

- Nothing to remember to run before working on code
- No transpilation or bundling needed for your own code or even the code of your dependencies

Too good to be true?
And yet, it is not.

## How does it work?

You run `nudeps` once to initialize the project.
It will generate an `importmap.js` file that you include in your HTML like so:

```html
<script src="/importmap.js"></script>
```

> [!IMPORTANT]
> This script needs to be included before any modules are loaded

You can include that one line of HTML either manually or via your templating system of choice.

Nudeps then copies your dependencies to `./client_modules` and generates an import map that maps specifiers to URLs like `./client_modules/vue@3.5.26/dist/vue.runtime.esm-bundler.js`.
Cache busting just works, because the version number is part of the directory name.

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
| Use dependencies without having to transpile your _own_ code.           | ✅     | ✅        |
| No "browser bundle" nonsense: common transitive dependencies are shared | ✅     | ✅        |
| Separate files are kept separate and cached separately.                 | ✅     | ✅        |
| `npm link` still works                                                  | ✅     | ✅        |
| No build process to remember to run before working on code              | ✅     | ❌        |
| Granular cache busting, only for modules that change version            | ✅     | CDNs only |
| Import map automatically updated as you install packages                | ✅     | ❌        |
| Supports CDNs like unpkg, jsdelivr, etc.                                | ❌     | ✅        |
| Self-host dependencies                                                  | ✅     | ❌        |

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

Either run `nudeps install` to automatically add the necessary scripts to your `package.json`, or add a `dependencies` script manually:

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

| Option               | Config file key | CLI option  | CLI short flag | Default            | Description                                                                                                                                                                                                              |
| -------------------- | --------------- | ----------- | -------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- |
| Directory            | `dir`           | `--dir`     | `-d`           | `./client_modules` | Directory to copy deployed dependencies to, relative to project root. It will be created if it does not exist. It is assumed that Nudeps owns this directory, do not use a directory path that you use for other things. |
| Import map           | `map`           | `--map`     | `-m`           | `importmap.js`     | File path for import map injection script, relative to project root. Nudeps needs to be able to own this file, do not input a file you use for other things too.                                                         |
| Prune                | `prune`         | `--prune`   |                | `false`            | Whether to subset only to specifiers used by the package entry points (`true`), or include all direct dependencies anyway.                                                                                               |
| Exclude              | `exclude`       | `--exclude` | `-e`           | `[]`               | Any packages to exclude from import map even though they appear in `dependencies`. Useful for server-side dependencies. When providing via the command line option, comma-separate and do not include any spaces.        |     |
| External config file | -               | `--config`  | `-c`           | `nudeps.json`      | File path for nudeps configuration, relative to project root.                                                                                                                                                            |
| Overrides            | `overrides`     | -           | -              | `{i}`              | Overrides for the import map, using `./node_modules/` paths. Set a key to `undefined` to remove it from the map.                                                                                                         |

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

### Why does it copy the entire dependency directory and not just the files I import?

Because this allows dependencies to fetch other files dynamically, e.g. stylesheets, images, etc.

### Why does it add the version number to the directory name?

Because this allows you to get the same cache busting behavior as you would with a CDN, but in your own domain.

### Do I need to add `.nudeps`, `client_modules` and `importmap.js` to my `.gitignore`?

This is up to you.

- `.nudeps` and `client_modules` include local `.gitignore` files that prevent you from accidentally committing paths from them, but you may want to gitignore them at the top level so that you don't see them in your IDE.
- Whether you gitignore `importmap.js` is up to you. On one hand it's a generated file, and these generally should not be committed, on the other hand it can help track changes to dependencies in a compact way.

## Troubleshooting

While most packages should work fine, some packages make certain over-reaching assumptions about the environment they are running in.

### Package assumes a bundler is being used

Some packages don't just use specifiers — they actively assume that if they can use specifiers, it _must_ mean that a bundler is being used and that the environment is NodeJS or similar.
For example, as of this writing, using `vue` out of the box will fail with an error about `process` not being available.

There are two ways to fix this:

- Use the package's browser bundle through the `overrides` option. This is usually not advisable because it inlines dependencies that other packages may be using too, but sometimes it's the way to go.
- Stub NodeJS objects like `process`. This can work if the surface area is limited, but it can quickly turn into a game of whack-a-mole. Additionally, it can cause bugs in other packages that depend on the presence of these objects to _detect_ NodeJS.
