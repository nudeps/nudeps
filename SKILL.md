---
name: nudeps
description: Use when a project has nudeps in devDependencies or dependencies, has a nudeps.js config file, or has a package.json script that runs nudeps.
---

# nudeps — Bundler-Free Dependency Management

Copies npm packages to a local output directory, generates an import map mapping bare specifiers to local versioned paths. No bundler, no build step. Output paths are configurable — check the nudeps config file (default `nudeps.js`, configurable via `--config`) or option defaults before assuming directory/file names.

## Common Mistakes

| Mistake                                                         | Fix                                                                                                                                                                                             |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Running `npx nudeps` after `npm install`/`npm uninstall`        | Check package.json `scripts` for any value containing `nudeps`. If a hook runs it → don't run manually. If no hook → run `npx nudeps` explicitly                                                |
| `<script type="module" src="importmap.js">`                     | Must be a classic script: `<script src="importmap.js">`. Using `type="module"` dramatically reduces browser support                                                                             |
| Editing files under the output directory or the import map file | These are generated artifacts owned by nudeps — changes get overwritten. Check the nudeps config or option defaults (`dir`, `map`) to know which paths are managed                              |
| Importing a CJS package with `import`                           | nudeps reports which packages are CJS in its output. For those, use `import { require } from "cjs-browser-shim"` then `const pkg = require("pkg-name")`. If `cjs` option is disabled, enable it |
| Using bare specifiers in Web Workers                            | Specifiers don't work in workers — this is a platform limitation, not a nudeps bug                                                                                                              |
| Modifying the `dependencies`/`prepare` scripts in package.json  | These are npm lifecycle hooks installed by nudeps — don't edit or call them manually                                                                                                            |
| Hardcoding `client_modules/` or `importmap.js` paths            | These are configurable defaults (`dir` and `map` options). Read the project's nudeps config to determine actual paths                                                                           |
| Specifier fails to resolve at runtime                           | Ensure entry points are declared in package.json, then run `npx nudeps`. See Troubleshooting in README.md (in the nudeps package directory)                                                     |
| Using an unsupported package manager                            | Only npm is officially supported. nudeps reads `node_modules/.package-lock.json` which other package managers may not produce                                                                   |

## Lifecycle

`npx nudeps install` (one-time setup) adds two npm hooks to package.json:

- **`dependencies`** — fires after `npm install <pkg>` / `npm uninstall <pkg>`
- **`prepare`** — fires on bare `npm install` (e.g., after cloning) and before `npm pack`/`npm publish`

If these hooks exist, nudeps runs automatically — **do not run it manually**. If they don't exist, run `npx nudeps` explicitly after dependency changes.

Use `npx nudeps --init` to force a full re-initialization (clears caches and regenerates everything).

## Setup (New Projects)

```bash
npx nudeps install   # one-time: installs nudeps, adds hooks, sets type: "module", generates import map
npm install <pkg>    # import map auto-updates via hooks (see Lifecycle above)
```

Include the import map **before any module scripts**, as a classic (non-module) script:

```html
<!-- path depends on the `map` option in nudeps config (default: importmap.js) -->
<script src="importmap.js"></script>
<script type="module" src="app.js"></script>
```

Then use bare specifiers in your modules:

```js
import { someFunction } from "some-package";
```

## Config (default: `nudeps.js`, configurable via `--config`)

Config file uses ES module syntax: `export default { ... }`.

| Option    | Default            | Description                                                                                                                                              |
| --------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dir`     | `"client_modules"` | Output directory for copied packages                                                                                                                     |
| `map`     | `"importmap.js"`   | Import map injection script path                                                                                                                         |
| `mode`    | —                  | Preset: `"dev"` (symlink) or `"prod"` (prune + terse)                                                                                                    |
| `exclude` | `[]`               | Packages to omit from import map (e.g., server-only deps)                                                                                                |
| `cjs`     | `true`             | Include CJS shim for CommonJS packages                                                                                                                   |
| `prune`   | `false`            | Subset import map to only used specifiers                                                                                                                |
| `alias`   | `true`             | Unversioned symlinks for stable asset URLs (CSS, images). Use the unversioned path in HTML/CSS (e.g., `<link href="[output-dir]/open-props/style.css">`) |

Full option reference and troubleshooting: see README.md in the nudeps package directory.

## CJS Packages

nudeps automatically detects CJS packages and logs a message like:

> 2 CommonJS packages detected, adding cjs-browser-shim. Use require() to import these packages: react, react-dom. Disable with --cjs=false

**Don't guess whether a package is CJS** — read nudeps' output after install. If you can't see the output (truncated, CI, etc.), check whether `cjs-browser-shim` appears in the generated import map file — if it does, CJS packages were detected.

If the `cjs` option is `false` and you need CJS packages, set it to `true` in the nudeps config and run `npx nudeps`.

For CJS packages, use the shim pattern:

```js
import { require } from "cjs-browser-shim";
const { createElement } = require("react");
```

## Output

nudeps logs a summary after each run: number of import map entries, time taken, and cache hits. If packages were copied or deleted, that's logged too. Warnings about CJS packages, missing lockfiles, or local dependencies appear inline — read them before proceeding.

## Local Dependencies

`npm install ../other-repo` works — nudeps symlinks local packages by default instead of copying. If the local dep doesn't have nudeps installed, a warning is printed — run `npx nudeps install` there too. When the local dependency's import map changes, nudeps automatically propagates to dependents.

## npm Workspaces

Running nudeps inside a workspace package works: it finds the lockfile at the monorepo root (deps are hoisted there), so hoisted dependencies and sibling workspace packages both resolve — hoisted deps get copied, siblings get symlinked into the package's output dir. Limitation: change propagation between sibling workspace packages is not wired up.

## Programmatic API

For build scripts or CI pipelines that need nudeps as a step. Accepts the same options as the config file:

```js
import nudeps from "nudeps";
await nudeps({ prune: true });
```

## Generated Artifacts — Do Not Edit

- **Output directory** (`dir` option) — copied/symlinked packages
- **Import map file** (`map` option) — auto-generated injection script
- **`.nudeps/`** — cache directory

All three contain `.gitignore` files preventing accidental commits. Add top-level ignores (using actual configured `dir` and `map` values) to hide them from your IDE.
