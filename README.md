# Remark My Words

**Read a PDF. Mark a passage. Give your thoughts room.**

Remark My Words is an Obsidian community plugin for reading and annotating PDFs.
Write categorized comments beside passages, then open a native Obsidian canvas
with every PDF page and movable comment cards.
Use it for manuals, reports, books, articles, and other PDF documents in your vault.

![PDF page surrounded by categorized comment cards and colored connectors](docs/images/canvas-preview.png)

*Page layout preview with a sample document in the browser test harness.*

## Read closely, think spatially

| Reading mode | Canvas mode |
| --- | --- |
| Focus on one PDF page with normal scrolling. | Put all pages on one native Obsidian canvas. |
| Select a passage and add a comment from the floating toolbar. | Move pages and comment cards, create groups, and use native menus. |
| Click a highlight or open comments in the right sidebar. | Jump to a moved page from the left sidebar. |
| Keep your reading position when saving a comment. | Rearrange pages vertically with comments on both sides. |

Use the default categories or create your own categories for each annotation.
Each comment can have a title, description, and tags.
Page thumbnails and document-wide notes are included.

## Install

Requires **Obsidian 1.13.7 or later**, using an up-to-date app or desktop installer.
Mobile installation is enabled for testing. iPhone/iPad testing requires iOS/iPadOS
17.4 or later; compatibility with the actual Obsidian mobile app is still being
verified. Browser simulations cover PDF rendering and basic comment workflows,
but do not certify native text selection, the on-screen keyboard, or vault storage.

Install **Remark My Words** from **Settings → Community plugins → Browse**.
The PDF renderer is bundled with the plugin, so no additional download is needed.

## Get started

1. After installing, enable **Remark My Words** under **Settings > Community plugins**.
2. Run **Remark My Words: Open PDF** from the command palette or click the pen-and-file ribbon icon. The active PDF opens immediately; otherwise choose a PDF from the vault. You can also right-click a PDF and choose **Open in Remark My Words**.
3. Use **Reading mode** to annotate, or **Canvas mode** to open the whole document in Obsidian Canvas. Enable Obsidian's **Canvas** core plugin. **Page layout** keeps the original single-page annotation layout available.
4. Select text, click a category in the floating toolbar, and fill in **Add comment**. Right-clicking selected text also offers categories.
5. In Reading, click a highlighted passage to open its comment, then use **Edit** or **Delete** as needed. **Read page comments** opens a dockable right sidebar that follows page navigation and supports editing and deletion.
6. In Canvas, use Obsidian's normal selection, dragging, resizing, grouping, right-click menus, and undo/redo. The **PDF pages** sidebar on the left jumps to each page's current position. **Rearrange pages and comments** places pages underneath each other, leaving room for comments on both sides and preserving group membership.

The canvas is saved next to the PDF as `<document>.pdf.remark.canvas`. It contains
native PDF embeds that open at their assigned page, and editable text cards linked
to those page cards. The canvas uses Obsidian's own appearance and controls.
Use **Edit source comment** on a card or the right sidebar to change the original
PDF annotation. **Refresh comments from PDF** updates generated cards and adds
new annotations. Direct edits to canvas text remain independent and are preserved;
refreshing does not overwrite them or restore cards you removed. Reopening Canvas
from the reader also refreshes comments while keeping your layout, groups, and
additional cards. Use **Rearrange** when new comments need more space.

Navigate pages with thumbnails, arrows, or the page number. In Reading, mouse-wheel
scrolling past the bottom opens the next page at its top, or past the top opens the
previous page at its bottom. On touchscreens, use the page controls to change pages.
Deleting a comment asks for confirmation.

## Customize

Click **Customize** in the PDF toolbar. The same manager is available from
**Settings > Remark My Words** and the command palette. Choose the plugin
interface colors for the background, panels, borders, text, secondary text, and
accent states. You can also add a category, change its name, color, or icon,
move it up or down, or delete it; then choose **Save**. Category order applies to
selection tools, filters, and comment menus. **Cancel** leaves the previous
settings unchanged.

The initial categories remain **Claim, Evidence, Method, Concept, Limitation,
and Note**. Changes apply across PDFs in this vault and survive restarting
Obsidian. Keep at least one category. Deleting a category removes it from new
comment choices; existing comments keep their category and remain editable.
An existing deleted category appears as **(deleted)** in the comment editor.

## Your data stays in your vault

The plugin does not send PDFs, comments, or notes to an external service. It has
no accounts, telemetry, or paid features. Normal reading and annotation do not
make network requests. Plugin installation and updates are handled by Obsidian
and GitHub.

Comments and notes are stored beside the PDF in a readable JSON file:

```text
document.pdf
document.pdf.obsidian-annot.json
```

The original PDF is not modified. Keep the PDF and its annotation file together
when moving or backing up your documents. Renaming the PDF currently requires
renaming its annotation file to match. Your vault's existing sync service can
sync these files; the plugin does not provide its own synchronization.

## Keyboard shortcuts

The shortcuts below apply to Reading and Page layout. Native Canvas uses
Obsidian's own shortcuts and touch controls. On touchscreens, spread or pinch two
fingers over the reader to zoom around their midpoint. In Reading, one finger
scrolls the page; in Page layout, use the hand tool to pan with one finger.

| Shortcut | Action |
| --- | --- |
| V / H | Select text / pan canvas |
| + / − | Zoom in / out |
| Ctrl/⌘ + wheel | Zoom around the pointer |
| 0 | Fit page and cards in Canvas; fit page width in Reading |
| Page Up / Page Down | Previous / next page |
| Escape | Dismiss a preview or clear the selection |
| Arrow keys on a focused card | Move by 10 units; Shift moves by 40 |
| Enter on a focused card | Edit the comment |
| Ctrl/⌘ + Enter in the description field | Save the comment |

## Current limits

- Reading and Page layout display one PDF page at a time; native Canvas contains all pages.
- Native canvas connections attach to page cards. Passage-level highlights and annotation editing remain in the reader and Page layout.
- Scanned documents need an existing text layer; OCR is not included.
- Annotations live in the JSON file, not as native annotations inside the PDF.
- Concurrent edits to the same PDF from multiple views or devices are not merged.
- Mobile installation is available for testing; compatibility in the actual Obsidian iOS and Android apps has not yet been verified.

## Feedback and development

[Report a bug or request a feature](https://github.com/hoelk-f/remark-my-words/issues).
For bugs, include your Obsidian version, plugin version, operating system, and
steps to reproduce. Share only non-sensitive sample documents.

- [Contributing](CONTRIBUTING.md)
- [Development, architecture, and data format](docs/DEVELOPMENT.md)
- [Release and Community directory submission guide](docs/RELEASING.md)
- [Changelog](CHANGELOG.md)

## License

Remark My Words is released under the [MIT License](LICENSE).
PDF rendering uses Mozilla's [PDF.js](https://mozilla.github.io/pdf.js/), licensed
under [Apache 2.0](docs/licenses/pdfjs-dist.txt). License notices are retained in
the distributed bundle. See [third-party notices](THIRD_PARTY_NOTICES.md).

This is an independent community project, not an official Obsidian product.
