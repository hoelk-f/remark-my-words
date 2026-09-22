import { setIcon } from "obsidian";
import { Annotation, CategoryStyle } from "./model";

/** A reading preview outside the scaled PDF; highlights remain pointer-transparent. */
export class CommentPreview {
  private el: HTMLDivElement;
  private returnFocus: HTMLElement | null = null;
  private get win() { return this.root.ownerDocument.defaultView!; }

  constructor(
    private root: HTMLElement,
    private viewport: HTMLElement,
    private categoryFor: (annotation: Annotation) => CategoryStyle,
    private actions: { edit: (annotation: Annotation) => void; remove: (annotation: Annotation) => void }
  ) {
    this.el = root.createDiv({ cls: "pdfaw-comment-preview", attr: { role: "region", "aria-label": "Comments", tabindex: "0" } });
    this.el.hidden = true;
    this.el.addEventListener("focusout", event => { if (!this.contains(event.relatedTarget as Node | null)) this.hide(); });
    this.el.onkeydown = event => {
      if (event.key === "Escape") { event.stopPropagation(); this.hide(); }
    };
  }

  show(annotations: Annotation[], anchor: { left: number; bottom: number; top: number }, opener?: HTMLElement) {
    this.returnFocus = opener ?? null;
    this.el.empty(); this.el.hidden = false;
    const heading = this.el.createDiv({ cls: "pdfaw-preview-heading" });
    heading.createSpan({ text: annotations.length === 1 ? "Comment" : "Comments" });
    const close = heading.createEl("button", { cls: "pdfaw-icon-button", attr: { type: "button", "aria-label": "Close preview" } });
    setIcon(close, "x"); close.onclick = () => this.hide();
    if (!annotations.length) this.el.createDiv({ text: "No comments on this page yet." });
    for (const annotation of annotations) {
      const category = this.categoryFor(annotation);
      const item = this.el.createEl("article", { cls: "pdfaw-preview-item" });
      item.style.setProperty("--category", category.hex);
      const badge = item.createDiv({ cls: "pdfaw-preview-category" });
      setIcon(badge.createSpan(), category.icon); badge.createSpan({ text: category.label });
      if (annotation.title) item.createEl("h3", { text: annotation.title });
      item.createDiv({ cls: "pdfaw-preview-body", text: annotation.comment?.trim() || annotation.text });
      if (annotation.tags?.length) item.createDiv({ cls: "pdfaw-preview-tags", text: annotation.tags.join(" · ") });
      const actions = item.createDiv({ cls: "pdfaw-preview-actions" });
      const edit = actions.createEl("button", { text: "Edit", attr: { type: "button", "aria-label": "Edit comment" } });
      setIcon(edit, "pencil");
      edit.onclick = () => { this.hide(); this.actions.edit(annotation); };
      const remove = actions.createEl("button", { text: "Delete", attr: { type: "button", "aria-label": "Delete comment" } });
      setIcon(remove, "trash-2");
      remove.onclick = () => {
        if (!this.win.confirm("Delete this comment?")) return;
        this.hide(); this.actions.remove(annotation);
      };
    }
    const view = this.viewport.getBoundingClientRect(), root = this.root.getBoundingClientRect();
    this.el.style.width = `${Math.min(360, view.width - 16)}px`;
    this.el.style.maxHeight = `${Math.max(80, view.height - 16)}px`;
    const width = this.el.offsetWidth, height = this.el.offsetHeight;
    const left = Math.max(view.left + 8, Math.min(view.right - width - 8, anchor.left));
    const below = anchor.bottom + 8;
    const top = below + height <= view.bottom - 8 ? below : Math.max(view.top + 8, anchor.top - height - 8);
    this.el.style.left = `${left - root.left}px`; this.el.style.top = `${top - root.top}px`;
    if (opener) this.el.focus({ preventScroll: true });
  }

  contains(target: Node | null) { return this.el.contains(target); }
  hide() {
    if (this.el.hidden) return;
    const hadFocus = this.contains(this.root.ownerDocument.activeElement);
    const opener = this.returnFocus; this.returnFocus = null;
    this.el.hidden = true;
    if (hadFocus) opener?.focus({ preventScroll: true });
  }
  destroy() { this.hide(); this.el.remove(); }
}
