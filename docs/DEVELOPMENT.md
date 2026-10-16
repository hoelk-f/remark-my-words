# Development

Use Node.js 22 or later. Dependency versions are pinned in `package.json` and
`package-lock.json`; use `npm ci` for a reproducible installation.

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run test:browser
npm run test:build
npm run package:release
```

`npm run dev` watches source changes. `npm run build` generates `main.js`.
`npm run package:release` builds, validates metadata, and copies the three
installable files into `dist/remark-my-words/`. No npm publication is needed.

## Architecture

- `src/main.ts`: Obsidian file view, PDF rendering, canvas camera, interactions, and serialized saves.
- `src/model.ts`: categories, sidecar validation and migration, canvas geometry.
- `src/selection.ts`: selection geometry from PDF text nodes.
- `src/editor.ts`: comment form.
- `src/comment-preview.ts`: Reading-mode previews.
- `styles.css`: plugin-scoped styles.
- `scripts/pdf-worker-plugin.mjs`: embeds the matching PDF.js worker as text at build time.
- `tests/`: model and browser integration tests.

PDF coordinates use a fixed scale of 1.35. Camera zoom is separate, so changing
the display does not change saved highlights or card positions. The PDF bitmap
is rendered at the current camera zoom times the display's pixel density, with
limits of approximately 16 megapixels and 8192 pixels per side. Zoom changes are
debounced for 120 ms; a completed bitmap replaces the previous one without
rebuilding the text layer or selection. Stale renders are canceled when zoom,
page, or document changes. Dialogs share the view's configured theme colors.
Rendering tasks
are canceled when pages or documents change. Each view creates a local Blob URL
for the bundled worker and revokes it when the view closes.

`pdfaw-view` and CSS class prefixes remain stable internal identifiers. They are
not the public plugin ID, which is `remark-my-words`.

## Browser tests

`npm run test:browser` starts a local HTTP server and a headless Chromium browser.
By default it uses Microsoft Edge at its standard Windows path. Set `BROWSER_PATH`
to another Chromium executable on macOS or Linux. The test uses a generated PDF,
real PDF.js rendering, and a mocked Obsidian API and in-memory vault.

It covers live selection, comments, previews, category changes, dragging at zoom,
Reading/Canvas switching, persistence, search, notes, invalid-data protection,
and narrow windows. It deliberately does not serve a separate worker file.
Screenshots are written to `.test-artifacts/`. The mock uses placeholder icons;
Obsidian provides the real icons in the host application.

CI builds on Windows and Linux and runs browser interactions on Windows. It has
not run on GitHub until these workflow files have been pushed.

## Data compatibility

The sidecar filename remains `<pdf-path>.obsidian-annot.json`, including after
the plugin rename. Version 2 has `pdfPath`, `notes`, and `annotations`. Each
annotation stores `id`, one-based `page`, `quads`, `text`, `category`, `color`,
timestamps, and optional `title`, `comment`, `tags`, and `position`.

| Previous category | Current category |
| --- | --- |
| criticism | limitation |
| question | note |
| positive | evidence |
| unclear | note |
| literature | evidence |
| method | method |

Version 1 color-only annotations map red to Limitation, yellow/orange to Note,
green/purple to Evidence, and blue to Method. Data is migrated in memory and
written on the next edit. Invalid sidecars are rejected without overwriting them.
New sidecars are created only when the user changes something. Pending notes are
flushed before switching documents or closing the view.

Concurrent changes from multiple views are not merged. Do not run both the old
development plugin and Remark My Words against the same documents.

## Review and reproducible builds

`npm run lint` uses the official Obsidian recommended rules with typed analysis.
The plugin name is registered as a proper brand for sentence-case checks. The
scoped npm override makes the linter use this project's pinned Obsidian types
instead of its older exact peer version.

`npm run test:build` builds in two independent temporary checkouts, including
different license line endings, and compares output bytes. The embedded worker
uses a stable virtual module ID, so local filesystem paths do not enter the
bundle. `npm run check:build` compares a fresh build with committed `main.js`;
CI runs this on both Windows and Linux. Commit the rebuilt bundle with source
changes. The release workflow attests all three installable assets before
publishing them.

PDF.js includes dynamic-code capability checks in its distributed source. We
set `isEvalSupported: false` when loading PDFs to disable optional eval-based
rendering optimizations. Static scanners may still flag the dependency code.

## Custom categories

Categories are stored through the Obsidian plugin data API, shared by all open
views in the current vault. Built-in IDs remain stable; new IDs use
`custom-<uuid>`. Renaming never changes an ID. Deletion archives the definition
so existing annotations still render, while active pickers omit it. At least
one category must remain active. Settings saves are serialized and stale
dialogs are rejected rather than overwriting newer edits.

Saved annotations may also contain `categoryStyle` (label, color, hex, icon).
This snapshot lets comments with custom IDs remain readable if plugin settings
are missing after a reinstall or when a sidecar is moved to another vault.
Vault settings take precedence when the same category ID exists. Category
changes update open views; snapshots are written with the next annotation save.
Older plugin versions cannot load custom category IDs; use version 0.2.0 or newer
for sidecars containing custom categories. The sidecar format version stays 2.

`tests/categories.test.mjs` covers persistence, migration, validation and save
failures. `tests/category-browser.mjs` exercises the manager, PDF picker,
existing comments after deletion, and a narrow viewport in the browser harness.
