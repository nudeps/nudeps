# NuDeps

Your dependencies, naked.

For background, see [Web dependencies are broken. Can we fix them?](https://lea.verou.me/blog/2026/web-deps/).
This package introduces lightweight tooling as an alternative to bundlers.
It is an opinionated wrapper over the excellent [JSPM Generator](https://jspm.org/) that provides an end-to-end solution for using specifiers in the browser.
Unlike JSPM, it does not aim to cover all possible use cases.
Instead, it aims to cover a subset of use cases with the best DX possible.

## Do I need nudeps or JSPM?

JSPM is excellent for generating import maps that let you use specifiers in the browser and is doing a lot of the heavy lifting here.

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

```bash
npm install nudeps -D
```

This will also automatically initialize it for the current project.

or globally:

```bash
npm install nudeps -gD
```

Then, whenever you want to initialize for a given project, just run `nudeps` in its root directory.
It will automatically detect that it has not run before and initialize.

To avoid having to run `nudeps` whenever you install or uninstall a dependency, add the following script to your `package.json`:

```json
"dependencies": "nudeps",
```

If you have another `dependencies` script, you can use `predependencies` to run `nudeps` before it or `postdependencies` to run `nudeps` after it.

Then, to use the import map in your app, include this script in your HTML before any modules are loaded, either manually or via your templating system of choice:

```html
<!-- Replace `importmap.js` with the path to your import map if different -->
<script src="importmap.js"></script>
```

## Config options

Each of the following options is available either as a config file key, or a command line option (e.g. `foo` would be `--foo`).
Some command line options allow for a shorthand one letter syntax, which is listed after a slash.

| Option | Config file key | CLI option | CLI short flag | Default | Description |
| ------ | --------------- | ---------- | -------------- | ------- | ----------- |

| Directory | `dir` | `--dir` | `-d` | `./client_modules` | Directory to copy deployed dependencies to, relative to project root. It will be created if it does not exist. It is assumed that Nudeps owns this directory, do not use a directory path that you use for other things. |
| Import map | `map` | `--map` | `-m` | `importmap.js` | File path for import map injection script, relative to project root. Nudeps needs to be able to own this file, do not input a file you use for other things too. |
| Prune | `prune` | `--prune` | | `false` | Whether to subset only to specifiers used by the package entry points (`true`), or include all direct dependencies anyway. |
| Excluded dependencies | `exclude` | `--exclude` | `-e` | `[]` | Any packages to exclude from import map even though they appear in `dependencies`. Useful for server-side dependencies. When providing via the command line option, comma-separate and do not include any spaces. |
| External config file | | `--config` | `-c` | `nudeps.json` | File path for nudeps configuration, relative to project root. |

## Commands

### `nudeps`

Initialize or update as needed.
Takes care of

- Copying dependencies to the target directory
- Generating a new import map

### `nudeps --prune`

Subset copied dependencies and import map to only those used by the package entry points.
Subsequent runs of `nudeps` will respect previously pruned dependencies (unless you use `--init`).
This allows you to use dependencies immediately as they are added, without having to continuously watch all your JS files, and periodically run `nudeps --prune` to subset.

### `nudeps --init`

Force initialization, even if nudeps has already run.

## FAQ

### Does this support pnpm/bun/yarn/etc.?

At the moment, we’re focusing on nailing the best DX possible, and to let us focus on that, we're cutting scope by only supporting npm for now.
However, Nudeps should however work with any other package managers that follow similar conventions in terms of:

- `node_modules` directory structure
- `package-lock.json` file format
- `package.json` file format

You're welcome to contribute support for other package managers, but please let me know first so we can discuss the best approach.
