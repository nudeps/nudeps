# NuDeps

Your dependencies, naked.

For background, see [Web dependencies are broken. Can we fix them?](https://lea.verou.me/blog/2026/web-deps/).
This package introduces lightweight tooling as an alternative to bundlers.

It is an opinionated wrapper over [JSPM Generator](https://jspm.org/), that allows you to use specifiers effortlessly.

Features:

- Use dependencies without having to transpile your _own_ code.
- Use specifiers in the browser and distribute code with specifiers, guilt-free.
- No "browser bundle" nonsense: common transitive dependencies are shared
- Separate files are kept separate and cached separately. If you want to bundle you don't need this, use a bundler.
- Granular cache busting, only for modules that change version
- No need to run a build process while developing, the import map is automatically updated as you install packages
- `npm link` still works

Configuration options:

- Directory to copy deployed dependencies to (default: `/lib`)
- File path for import map injection script (default: `/importmap.js`)
- Any packages to exclude from import map even though they appear in `dependencies`

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

The rest of this readme will assume global installation (which lets you run `nudeps` directly).
For a local install, prepend all `nudeps` commands with `npx` (e.g. `npx nudeps init`).

Then, whenever you want to initialize for a given project, just run `nudeps` in its root directory.
To avoid having to run `nudeps` whenever you install or uninstall a dependency, add the following script to your `package.json`:

```json
"dependencies": "nudeps",
```

Then, to use the import map in your app, include this script in your HTML before any modules are loaded (replace `importmap.js` with the path to your import map if different):

```html
<script src="importmap.js"></script>
```

## Config

### `prune`

Default: `false`

Whether to subset only to specifiers used by the package entry points (`true`), or include all direct dependencies anyway.

### `dir` / `-d`

Default: `./client_modules`

Directory to copy deployed dependencies to, relative to project root.
It is assumed that Nudeps owns this directory,
do not use a directory name that you use for other things.

### `map` / `-m`

Default: `importmap.js`

File path for import map injection script, relative to project root.
Nudeps needs to be able to own this file, do not input a file you use for other things too.

### `exclude` / `-e`

Default: `[]`

Any packages to exclude from import map even though they appear in `dependencies`.
Useful for server-side dependencies.
When providing via the command line option, comma-separate and do not include any spaces.

### `config` / `-c`

Default: `nudeps.js`

File path for nudeps configuration

### `subset`/`

## Commands

### `nudeps`

Initialize or update as needed.
Takes care of

- Copying dependencies to the target directory
- Generating a new import map

### `nudeps --prune`

Subset copied dependencies and import map to only those used by the package entry points.

## TODO

- [ ] Incremental version
- [ ] Prod version

## FAQ

### Does this support pnpm/bun/yarn/etc.?

At the moment Nudeps only supports npm and any other package managers that follow similar conventions in terms of:

- `node_modules` directory structure
- `package-lock.json` file format
- `package.json` file format

You're welcome to contribute support for other package managers, but please let me know first so we can discuss the best approach.
