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

## Quick start

```bash
npx nudeps install
```

This adds an npm hook that regenerates your import map whenever dependencies change, then runs Nudeps once.
Include the generated import map in your HTML, in a classic (non-module) `<script>`, before any module scripts:

```html
<script src="/importmap.js"></script>
```

That's it. Now `npm install vue` and `import { createApp } from "vue"` just works — no bundler, no build step, no watcher.

## Documentation

**📖 [nudeps.dev](https://nudeps.dev)**

- [Getting Started](https://nudeps.dev/start/)
- [How It Works](https://nudeps.dev/how-it-works/) — including how Nudeps compares to JSPM
- [CLI](https://nudeps.dev/cli/)
- [Configuration](https://nudeps.dev/config/) — [deployed files](https://nudeps.dev/config/files/), [aliases](https://nudeps.dev/config/aliases/), [overrides & modes](https://nudeps.dev/config/overrides/)
- [Local Dependencies](https://nudeps.dev/local-deps/)
- [Programmatic API](https://nudeps.dev/api/)
- [FAQ](https://nudeps.dev/faq/) · [Troubleshooting](https://nudeps.dev/troubleshooting/)

Try it out in the [demos repository](https://github.com/nudeps/nudeps-demos), or browse them live at [nudeps.dev/demos](https://nudeps.dev/demos/).

### AI coding assistants

Nudeps ships with a [`SKILL.md`](SKILL.md) — a comprehensive reference that teaches AI coding agents how to work with nudeps correctly (lifecycle hooks, generated artifacts, CJS handling, common mistakes, etc.).

The easiest way to install it is via the [`skills`](https://github.com/nicepkg/skills) CLI, which supports 45+ agents including Claude Code, Cursor, and Copilot:

```bash
npx skills add nudeps/nudeps
```

## Background

- [Web dependencies are broken. Can we fix them?](https://lea.verou.me/blog/2026/web-deps/)
- [External import maps, today!](https://lea.verou.me/blog/2026/external-import-maps-today/)
- [Introducing Nudeps: Web dependencies, naked!](https://lea.verou.me/blog/2026/nudeps/) (upcoming)
