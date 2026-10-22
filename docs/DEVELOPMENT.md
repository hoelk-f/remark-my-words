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
- `src/sidebar.ts`: dockable page navigation and page comments.
- `src/board-model.ts`: layout validation, migration, spacing, snapping, and layout history.
- `src/pdf-pages.ts`: shared multipage surfaces with lazy raster and text-layer rendering.
- `styles.css`: plugin-scoped styles.
- `scripts/pdf-worker-plugin.mjs`: embeds the matching PDF.js worker as text at build time.
- `tests/`: model and browser integration tests.

PDF coordinates use a fixed scale of 1.35. Camera zoom is separate, so changing
the display does not change saved highlights or card positions. The PDF bitmap
is rendered at the current camera zoom times the display's pixel density, with
limits of approximately 16 megapixels and 8192 pixels per side, with a shared
24-megapixel target across visible pages and at most two main-page renders at a
time. A separate cache retains at most three offscreen pages and eight megapixels
of bitmap data, keeping the steady raster target near 32 megapixels. These limits
do not include PDF source bytes, decoded images, or transient replacement bitmaps.
Evicted pages release their text layer and request PDF.js page cleanup. Active
native PDF text selections remain pinned. Thumbnails render serially after the
first page becomes usable. Zoom changes are
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
Reading/Canvas switching, persistence, layout groups/history, page navigation, notes, invalid-data protection,
and narrow windows. It deliberately does not serve a separate worker file.
Screenshots are written to `.test-artifacts/`. The mock uses placeholder icons;
Obsidian provides the real icons in the host application.

CI builds on Windows and Linux and runs browser interactions on Windows.

## Unified PDF Canvas

Reading and Canvas share the PDF.js page surfaces. Canvas displays every page,
with page positions independent from comment positions. The title bar moves a
page without intercepting native passage selection. Page navigation centers on
the stored page position, and connections add that origin to page-local quads.

Selection supports Shift-click and a background marquee. Groups contain stable
`p:<page>` and `a:<annotation-id>` keys; dragging a group moves members by a shared
delta. Group frames follow their contents. Rearrange uses actual card heights and
PDF page sizes, keeps group membership, and spaces the next page after the taller
of the page and its two comment columns. Layout history snapshots only layout
state, so it cannot roll back comment edits or resurrect deleted annotations.

Use an isolated vault for host tests. Verify page dragging, thumbnail navigation
after moving a page, selection/grouping, actual Obsidian context menus, group
movement and naming, rearrange, undo/redo, reopening, the comments sidebar, and
category dropdowns. Browser mocks do not substitute for this host test or certify
iOS/Android. These host flows were exercised in Obsidian 1.14.4 on Linux for
0.4.0 and 0.4.1. The browser suite also tests a 120-page PDF and touch grouping.
Old `.remark.canvas` files are never read, updated, or removed by the
unified view. The protocol handler remains available for their source links.

## Large-document performance

Canvas starts fitted to page 1, and returning from Reading retains the saved
Canvas camera. Initial loading requests the first page and creates lightweight
placeholders for the rest. Exact page sizes are prepared in yielding batches;
direct navigation bypasses that queue. Only automatically placed, unmoved items
are adjusted as sizes arrive, while the camera preserves the current page anchor.
Saved positions remain unchanged. Rearrange waits for dimensions and measures
comment heights before placing all pages and comments.

Viewport updates run at most once per animation frame. Page visibility comes
from saved coordinates and the camera, without measuring each page element.
Camera changes do not rebuild lines or groups. Layout changes update only the
moved elements; connections reuse SVG nodes and update changed geometry. Card
heights come from measurement/resize notifications, not repeated pan-time reads.

Documents with more than 80 annotations mount only nearby cards (plus focused,
text-selected, or actively dragged cards). A card is recreated only when its
content changes. Layout/group selection continues to use all annotation records,
including unmounted cards; cached heights support offscreen geometry.

`tests/performance-browser.mjs` records first-page load time and frame samples
with 120 pages and 1,200 comments. Its stable assertions check zero per-page DOM
measurements and zero connection rebuilds for small camera moves, and fewer than
100 mounted cards in the tested first-page viewport. Local comparison with 0.4.0
reduced these counts from 3,600 measurements / 30 rebuilds / 1,200 mounted cards
to 0 / 0 / 10 across 30 moves. Timing output is diagnostic, without machine-specific
CI thresholds or claims about arbitrary PDFs or physical phones.

Additional tests stall background metadata, navigate directly to distant pages,
check saved/manual positions, verify bounded bitmap reuse, and render a generated
PDF with independent compressed images, text, vectors, and mixed page sizes.

## Data compatibility

The sidecar filename remains `<pdf-path>.obsidian-annot.json`, including after
the plugin rename. Version 2 has `pdfPath`, `notes`, and `annotations`. Each
annotation stores `id`, one-based `page`, `quads`, `text`, `category`, `color`,
timestamps, and optional `title`, `comment`, `tags`, and `position`.

An optional `canvasLayout` contains `version: 1`, `pages`, `cards`, `groups`, and
`snap`. Page/card maps store world-space `{x,y}` positions. Groups store a stable
`id`, `name`, and `members`. Old annotation `position` fields remain page-local
and unchanged; initial Canvas card placement adds the page origin. Canvas layout
is validated before edits and is saved with the annotations. Existing unknown
sidecar fields remain intact. Layout history is session-only.

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
