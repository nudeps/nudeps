---
name: nudeps
description: Use when a project has nudeps in devDependencies or dependencies, has a nudeps.js config file, or has a package.json script that runs nudeps.
---

# nudeps — Bundler-Free Dependency Management

Copies npm packages to a local output directory, generates an import map mapping bare specifiers to local versioned paths. No bundler, no build step. Output paths are configurable — check the nudeps config file (default `nudeps.js`, configurable via `--config`) or option defaults before assuming directory/file names.

## Common Mistakes

| Mistake                                                                                                                                  | Fix                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Running `npx nudeps` after `npm install`/`npm uninstall`                                                                                 | Check package.json `scripts` for any value containing `nudeps`. If a hook runs it → don't run manually. If no hook → run `npx nudeps` explicitly                                                                                                                                              |
| `<script type="module" src="importmap.js">`                                                                                              | Must be a classic script: `<script src="importmap.js">`. Using `type="module"` dramatically reduces browser support                                                                                                                                                                           |
| Thinking one import map can't serve a multi-page site, or that pages at different depths need a configurable base / root-relative output | The injection script rebases addresses to absolute URLs at runtime against its own location (`document.currentScript.src`), not the page's — so one map works from every page at any depth. Just reference it at a path that resolves to the file (root-relative `/importmap.js` is simplest) |
| Editing files under the output directory or the import map file                                                                          | These are generated artifacts owned by nudeps — changes get overwritten. Check the nudeps config or option defaults (`dir`, `map`) to know which paths are managed                                                                                                                            |
| Importing a CJS package with `import`                                                                                                    | nudeps reports which packages are CJS in its output. For those, use `import { require } from "cjs-browser-shim"` then `const pkg = require("pkg-name")`. If `cjs` option is disabled, enable it                                                                                               |
| Using bare specifiers in Web Workers                                                                                                     | Specifiers don't work in workers — this is a platform limitation, not a nudeps bug                                                                                                                                                                                                            |
| Modifying the `dependencies`/`prepare` scripts in package.json                                                                           | These are npm lifecycle hooks installed by nudeps — don't edit or call them manually                                                                                                                                                                                                          |
| Hardcoding `client_modules/` or `importmap.js` paths                                                                                     | These are configurable defaults (`dir` and `map` options). Read the project's nudeps config to determine actual paths                                                                                                                                                                         |
| Specifier fails to resolve at runtime                                                                                                    | Ensure entry points are declared in package.json, then run `npx nudeps`. See https://nudeps.dev/troubleshooting/                                                                                                                                                                              |
| Using an unsupported package manager                                                                                                     | Only npm is officially supported. nudeps reads `node_modules/.package-lock.json` which other package managers may not produce                                                                                                                                                                 |

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

Config file uses ES module syntax: `export default { ... }`. Unknown or invalid options throw with a pointed error (typos get a suggestion; pre-rename options name their replacement).

| Option             | Default            | Description                                                                                                                                                                                          |
| ------------------ | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dir`              | `"client_modules"` | Output directory for copied packages. Per-package overridable                                                                                                                                        |
| `map`              | `"importmap.js"`   | Import map injection script path                                                                                                                                                                     |
| `root`             | Workspace root     | Directory the host serves as `/`. Set it when `dir` lives inside a build output directory (e.g. an SSG's `dist/`), so hosts that need redirects write them there with correct URLs                   |
| `host`             | Auto-detected      | Deploy host adapter: `"netlify"`, `"vercel"`, `"cloudflare"`, `"gitHubPages"`                                                                                                                        |
| `mode`             | —                  | Active mode, tested by rules with `mode` matchers. Built-in presets: `"dev"` (symlink) and `"prod"` (no symlink + prune + terse)                                                                     |
| `prune`            | `false`            | Subset import map to specifiers the entry points use, plus `include: "force"` packages                                                                                                               |
| `terse`            | `false`            | Lightly minify the map script                                                                                                                                                                        |
| `module`           | `false`            | Emit the map script for `type="module"` loading (reduces browser support)                                                                                                                            |
| `cjs`              | `true`             | Include CJS shim for CommonJS packages. Per-package overridable                                                                                                                                      |
| `subpaths`         | `"split"`          | `"split"` keeps every used subpath mapping explicit; `"combined"` collapses within scopes; `"both"` also collapses top-level                                                                         |
| `symlink`          | External pkgs only | Symlink packages into `dir` instead of copying                                                                                                                                                       |
| `preserveSymlinks` | `false`            | Keep symlinks inside a copied package instead of resolving them                                                                                                                                      |
| `alias`            | `true`             | Unversioned symlink per package for stable asset URLs (CSS, images): `<link href="[dir]/open-props/style.css">`. A string is a custom path relative to the package's `dir` (may escape it: `"../x"`) |
| `imports`          | —                  | Import map entries merged into the generated map (`{ specifier: path }`, path relative to the map file; `undefined` deletes). In a package rule, paths are package-relative                          |
| `ignore`           | Readmes, dotfiles… | File globs (package-relative) to skip when copying. Entries: `"glob"`, `{ ignore: glob }`, or `{ copy: glob }` (reverses earlier ignores, including the defaults). Last match wins                   |
| `overrides`        | —                  | Conditional config rules — see below                                                                                                                                                                 |
| `hooks`            | —                  | Object of lifecycle hook callbacks (`constructed`, `create-aliases-start`, `create-aliases-after-external`, `create-aliases-end`). See [blissful-hooks](https://github.com/LeaVerou/blissful-hooks)  |

### Conditional overrides

One mechanism for per-package settings, mode presets, and combinations. Dictionary form for the common case (each key is one exact name or install name):

```js
export default {
	overrides: {
		"open-props": { alias: "../open-props" }, // stable URL at project root
		"canvas-confetti": { include: true }, // install beyond package.json deps (prunable)
		vue: { include: "force" }, // install AND survive prune
		"@netlify/blobs": { include: false }, // server-only: keep out of direct installs
		"legacy-lib": { cjs: false },
	},
};
```

Array form for patterns, versions, and modes — matchers are exact strings (semver ranges for `version`), regexes, predicates, or any-of arrays; multiple matcher fields AND together; a rule with no matchers is unconditional:

```js
export default {
	overrides: [
		{ mode: "staging", terse: false }, // mode preset (custom modes are just rules)
		{ installName: /^@types\//, include: false },
		{ name: "leaflet", version: "^1", ignore: "docs/**" },
		{ mode: "prod", name: "leaflet", symlink: false }, // package × mode
		{ name: "vue", imports: { vue: "./dist/vue.esm-browser.prod.js" } },
	],
};
```

Semantics agents must know:

- **Cascade**: all matching rules apply in order, later wins, merged per property. Origin order: option defaults < built-in mode rules < top-level config < user rules < CLI/programmatic args. Rule layers concatenate (a tool's programmatic rules compose with the config file's).
- **`include: false` does not guarantee absence** — the package still lands in the map if code actively imports it.
- `include: true`/`"force"` need exact-name matchers (you can't install a regex); `include: false` accepts patterns.
- Package-matched rules may only set package-scoped options (`dir`, `symlink`, `preserveSymlinks`, `alias`, `ignore`, `imports`, `cjs`, `include`); mode-only/unconditional rules may set anything.

Full option reference: https://nudeps.dev/config/ · Troubleshooting: https://nudeps.dev/troubleshooting/

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

Running nudeps inside a workspace package works: it finds the lockfile at the monorepo root (deps are hoisted there), so hoisted dependencies and sibling workspace packages both resolve — hoisted deps get copied, siblings get symlinked into the package's output dir. `npx nudeps install` in a workspace child automatically adds `dependencies` and `prepare` hooks to the workspace root that delegate to children (`npm run <hook> --if-present --workspaces`), so `npm install` at the root triggers import map generation in each child. On Netlify (and Cloudflare), workspace children write redirect rules to the **root** `_redirects` with the child directory as a path prefix — no per-child `_redirects` is created. This assumes the workspace root is the deploy root; if it isn't, set `root`. Limitation: change propagation between sibling workspace packages is not wired up.

## Programmatic API

For build scripts or CI pipelines that need nudeps as a step. Accepts the same options as the config file:

```js
import nudeps from "nudeps";
let { config } = await nudeps({ prune: true });
```

Returns the `Nudeps` instance, whose `config` holds the resolved options (`dir`, `map`, etc.) — read it instead of guessing paths. Returns `null` when the run is skipped (workspace child installing before the lockfile exists).

Pass `defaults` to suggest values the user's own config still wins over — useful when a tool (e.g. an SSG) wants its own paths unless the project says otherwise:

```js
await nudeps({ defaults: { dir: "dist/client_modules", root: "dist" } });
```

## Generated Artifacts — Do Not Edit

- **Output directory** (`dir` option) — copied/symlinked packages
- **Import map file** (`map` option) — auto-generated injection script
- **`.nudeps/`** — cache directory

All three contain `.gitignore` files preventing accidental commits. Add top-level ignores (using actual configured `dir` and `map` values) to hide them from your IDE.
