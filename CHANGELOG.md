# Changelog

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
