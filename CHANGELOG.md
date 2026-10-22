# Changelog

## 0.4.2 — 2026-10-22
- Export selected comments as one combined Markdown file or one file per comment, with optional document notes, PDF page links, and links back to the original comments. Selected pages and groups include all their comments, including filtered or offscreen cards.
- Create exports inside the vault without overwriting existing files. Use numbered names for duplicates and resume remaining files after a partial export failure.
- Use click to select one Canvas item and Ctrl/Command/Shift-click to extend or toggle the selection. Drag selected items together and extend marquee selections with the same modifiers; retain the touch multiple-selection button.
- Move Undo and Redo next to page navigation, update the Rearrange icon, remove the Group selection toolbar button while preserving menus and shortcuts, and simplify Canvas actions. Add icons to Select all pages and comments and more space above Add category.
- Attribute future release commits and GitHub releases to hoelk-f, with identity checks before publication.
- Verify selection, grouping, toolbar controls, both Markdown export formats, PDF links, and the 120-page/1,200-comment Canvas directly in Obsidian 1.14.4 on Linux.
- Cover Markdown exports, selection, groups, history, large PDFs, touch gestures, persistence, and release safeguards with automated regression tests. Actual iOS/Android app testing remains pending.

## 0.4.1 — 2026-10-22
- Start Canvas fitted to the first PDF page. Keep the full overview available through Fit PDF and comments, and restore the previous Canvas camera when returning from Reading.
- Show the first page before preparing all remaining page sizes. Load dimensions in yielding batches and let direct navigation bypass the background queue, preserving saved and manually moved positions.
- Coalesce viewport work per animation frame and calculate visibility from page coordinates. Panning and zooming no longer rebuild unchanged connection lines or group frames.
- Reuse comment cards and SVG connections; virtualize large comment collections and cache card measurements. Grouping, selection, and saved layout still include offscreen items.
- Keep the current page usable if loading a requested page fails, and allow retrying navigation.
- Keep a bounded cache of recently viewed PDF pages, serialize thumbnails, and clean up evicted PDF.js page resources.
- Verify the updated view directly in Obsidian 1.14.4 on Linux. Actual iOS/Android app testing remains pending.
- Add performance regression checks with 120 pages and 1,200 comments, blocked-loading/navigation cases, cache limits, and image/vector PDFs with mixed page sizes. Retain existing selection, Reading, category, group, history, persistence, and touch coverage.

## 0.4.0 — 2026-10-21
- Replace the separate native Canvas and Page layout modes with one multipage PDF Canvas, retaining direct text selection, highlights, and passage connections.
- Move PDF pages and comment cards independently; navigate from thumbnails to each page’s current position.
- Add Shift-click and marquee selection, named groups, shared group dragging, layout undo/redo, and optional grid/object snapping.
- Use Obsidian context menus for pages, comments, groups, and the background.
- Rearrange every page vertically with measured spacing and comments on both sides, preserving group membership.
- Save layout in the existing annotation JSON without changing legacy highlight coordinates or touching older `.remark.canvas` files.
- Render visible page bitmaps on demand with bounded concurrency and resolution; release offscreen bitmaps and text layers.
- Add touch-friendly multiple selection and a Canvas actions menu for grouping without a keyboard or right-click.
- Fit long documents into the overview and verify lazy rendering with a 120-page PDF.
- Verify multipage layout, grouping, history, navigation, persistence, text selection, categories, Reading, and pinch gestures in automated tests.
- Verify the unified view directly in Obsidian 1.14.4 on Linux, including native menus, actual dragging, saved groups, sidebar, and dropdowns. Actual iOS/Android app testing remains pending.

## 0.3.0 — 2026-10-21
- Open a native Obsidian canvas with every PDF page as a movable file card and comments on both sides. Native grouping, context menus, resizing, and undo/redo are available.
- Add a left PDF page sidebar that navigates to each page's current canvas position, including after manual moves.
- Rearrange all pages vertically, calculating spacing from actual card dimensions and retaining native groups and additional cards.
- Move Read page comments into a dockable right sidebar with page navigation, editing, and deletion.
- Preserve native card edits, removals, groups, and layout when refreshing comments from the PDF. Source annotations remain editable through the sidebar and card links; direct native text edits stay independent.
- Allow reordering categories and apply that order across menus, filters, and selection tools.
- Fix repeating dropdown arrows in comment and category dialogs.
- Keep the original single-page annotation canvas under Page layout; open PDFs in Reading by default.
- Verify real native Canvas interactions in Obsidian 1.14.4 on Linux, plus browser, touch, layout, persistence, and invalid-data regression tests. Native mobile app verification remains pending.

## 0.2.15 — 2026-10-18
- Enable mobile installation for testing in Obsidian on iPhone, iPad, and Android. Mobile app compatibility is still being verified; iOS/iPadOS 17.4 or later is required for the bundled PDF renderer.
- Add two-finger pinch zoom in Canvas and Reading modes, keeping the PDF point under the finger midpoint and preserving one-finger scrolling and hand-tool panning.
- Cover zoom limits, canceled gestures, remaining and additional fingers, and page/mode changes with browser touch regression tests.
- Document that changing pages by touch uses the page controls; swiping past the page boundary does not turn the page.

## 0.2.14 — 2026-10-16
- Enter the previous page at its bottom when scrolling upward in Reading mode.
- Apply the plugin palette to comment, customization, PDF picker, and deletion dialogs; use the same deletion confirmation in Reading and Canvas.
- Render PDF bitmaps for the current zoom and display density, preserving text selection and highlights while replacing the bitmap without flicker.

## 0.2.13 — 2026-10-09

- See the GitHub release notes for the included changes.

## 0.2.12 — 2026-09-22

- See the GitHub release notes for the included changes.

## 0.2.11 — 2026-09-22

- See the GitHub release notes for the included changes.

## 0.2.10 — 2026-09-22

- See the GitHub release notes for the included changes.

## 0.2.9 — 2026-09-22

- Remove the document search bar and Pages heading; let Customize control the full plugin color theme.

## 0.2.8 — 2026-09-22

- See the GitHub release notes for the included changes.

## 0.2.7 — 2026-09-22

- See the GitHub release notes for the included changes.

## 0.2.6 — 2026-09-22

- See the GitHub release notes for the included changes.

## 0.2.5 — 2026-09-19
- Open Reading-mode comments by clicking highlighted passages instead of hovering; keep previews open until dismissed.
- Preserve text selection when dragging across highlights and keep comment editing, deletion, and keyboard access available.

## 0.2.4 — 2026-09-19
- Describe the plugin for PDFs in general, including manuals, reports, books, and articles.

## 0.2.3 — 2026-09-19

- See the GitHub release notes for the included changes.

## 0.2.2 — 2026-09-19

- Keep Reading-mode comment previews open when hidden canvas cards report size changes after editing or deleting comments.
- Cover immediate preview reopening, keyboard focus restoration, and actual viewport resizing in the browser regression tests.

## 0.2.1 — 2026-09-19
- Let readers edit or delete a comment directly from its Reading-mode hover preview.

## 0.2.0 — 2026-09-18
- Keep the Open PDF command visible without an active PDF and offer a searchable vault PDF picker.
- Add a ribbon shortcut and a searchable plugin settings page.
- Add a vault-wide category manager for names, colors, icons, creation, and deletion while keeping the six existing defaults.
- Preserve existing comments when categories are deleted and store category appearance with saved comments.
- Update selection tools, filters, comment forms, canvas cards, and reading previews when categories change.

## 0.1.2 — 2026-09-18

- See the GitHub release notes for the included changes.

## 0.1.1 — 2026-09-18
- Fix Community review errors by moving reading/canvas layout styles into CSS classes and custom properties.
- Validate annotation JSON with explicit types while preserving legacy migration and unknown stored fields.
- Remove redundant command branding and unnecessary CSS !important overrides.
- Make the embedded PDF worker path and license line endings reproducible across build environments.
- Run the official Obsidian linter, compare rebuilt artifacts against committed main.js, and attest release assets in GitHub Actions.
- Disable optional PDF.js eval-based rendering optimizations.

## 0.1.0 — 2026-09-18

- Introduce Remark My Words, previously developed as `obsidian-pdf-annotator-comment`.
- Reading and Canvas modes with shared PDF annotations.
- Claim, Evidence, Method, Concept, Limitation, and Note categories.
- Live red text selection, categorized comments, descriptions, and tags.
- Movable cards, connected highlights, minimap, page thumbnails, and search.
- Reading-mode comment previews and document-wide notes.
- Backward-compatible sidecar loading and legacy category migration.
- Bundle the PDF.js worker so installation needs only three release files.
- Add reproducible builds, CI, release validation, and one-command release automation.
