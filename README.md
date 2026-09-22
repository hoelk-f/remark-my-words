# Remark My Words

**Read a PDF. Mark a passage. Give your thoughts room.**

Remark My Words is an Obsidian community plugin for reading and annotating PDFs.
Write categorized comments beside passages, then switch to a canvas where your
notes become movable cards connected to the original text.
Use it for manuals, reports, books, articles, and other PDF documents in your vault.

![PDF page surrounded by categorized comment cards and colored connectors](docs/images/canvas-preview.png)

*Canvas preview with a sample document in the browser test harness.*

## Read closely, think spatially

| Reading mode | Canvas mode |
| --- | --- |
| Focus on one PDF page with normal scrolling. | Arrange comment cards around the PDF. |
| Select a passage and add a comment from the floating toolbar. | Follow colored connectors back to the source passage. |
| Click a highlight to read, edit, or delete its comment. | Pan, zoom, filter categories, and arrange cards. |
| Keep your reading position when saving a comment. | Keep your card positions when switching modes. |

Use the default categories or create your own categories for each annotation.
Each comment can have a title, description, and tags.
Page thumbnails and document-wide notes are included.

## Install

Initial release target: **Obsidian Desktop 1.13.7 or later**, using an up-to-date
Obsidian installer. Mobile support is not enabled for the initial release.

Install **Remark My Words** from **Settings → Community plugins → Browse**.
The PDF renderer is bundled with the plugin, so no additional download is needed.

## Get started

1. After installing, enable **Remark My Words** under **Settings > Community plugins**.
2. Run **Remark My Words: Open PDF** from the command palette or click the pen-and-file ribbon icon. The active PDF opens immediately; otherwise choose a PDF from the vault. You can also right-click a PDF and choose **Open in Remark My Words**.
3. Use the **book** icon for Reading or the **dashboard** icon for Canvas. Tooltips identify each control.
4. Select text, click a category in the floating toolbar, and fill in **Add comment**. Right-clicking selected text also offers categories.
5. In Reading, click a highlighted passage to open its comment, then use **Edit** or **Delete** as needed. Click outside the preview, press **Escape**, or use its close button to dismiss it. The **Read page comments** button also works with a keyboard or touch input.
6. In Canvas, drag a card by its header. Double-click it to edit; its **…** menu provides category changes and deletion.

Navigate pages with thumbnails, arrows, or the page number.

## Customize

Click **Customize** in the PDF toolbar. The same manager is available from
**Settings > Remark My Words** and the command palette. Choose the plugin
interface colors for the background, panels, borders, text, secondary text, and
accent states. You can also add a category, change its name, color, or icon, or
delete it; then choose **Save categories**. **Cancel** leaves the previous
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

- One PDF page is displayed at a time in both modes.
- Scanned documents need an existing text layer; OCR is not included.
- Annotations live in the JSON file, not as native annotations inside the PDF.
- Concurrent edits to the same PDF from multiple views or devices are not merged.
- The initial release targets desktop. Automated browser tests do not replace testing in Obsidian, and mobile compatibility has not been verified.

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
