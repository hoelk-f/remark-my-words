import { App, ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import { Annotation } from "./model";
import { CategoryStore } from "./category-store";
import { applyThemeColors } from "./theme";

export const COMMENTS_VIEW = "remark-my-words-comments";
export const PAGES_VIEW = "remark-my-words-pages";
export type SidebarContext = {
  owner?: object;
  name: string; page: number; pages: number; annotations: Annotation[];
  jump: (page: number) => void; edit: (annotation: Annotation) => void; remove: (annotation: Annotation) => void;
  rearrange?: () => void; refresh?: () => void; read?: () => void;
};

export class PdfSidebar extends ItemView {
  constructor(leaf: WorkspaceLeaf, private type: typeof COMMENTS_VIEW | typeof PAGES_VIEW, private categories: CategoryStore, private current: () => SidebarContext | null) { super(leaf); }
  getViewType() { return this.type; }
  getDisplayText() { return this.type === COMMENTS_VIEW ? "PDF comments" : "PDF pages"; }
  getIcon() { return this.type === COMMENTS_VIEW ? "messages-square" : "files"; }
  async onOpen() { this.register(this.categories.subscribe(() => this.render())); this.render(); await Promise.resolve(); }
  render() {
    const root = this.contentEl; root.empty(); root.addClass("pdfaw-sidebar"); applyThemeColors(root, this.categories.themeColors());
    const context = this.current();
    if (!context) { root.createEl("p", { cls: "pdfaw-sidebar-empty", text: "Open a PDF in Remark My Words or its canvas." }); return; }
    root.createEl("h3", { text: context.name });
    if (this.type === PAGES_VIEW) {
      const actions = root.createDiv({ cls: "pdfaw-sidebar-actions" });
      if (context.read) this.action(actions, "book-open", "Read and annotate PDF", context.read);
      if (context.rearrange) this.action(actions, "layout-list", "Rearrange pages and comments", context.rearrange);
      if (context.refresh) this.action(actions, "refresh-cw", "Refresh comments from PDF", context.refresh);
      const list = root.createDiv({ cls: "pdfaw-sidebar-pages", attr: { "aria-label": "PDF pages" } });
      for (let page = 1; page <= context.pages; page++) {
        const button = list.createEl("button", { text: `Page ${page}`, attr: { type: "button", "aria-current": page === context.page ? "page" : "false" } });
        button.onclick = () => context.jump(page);
      }
      return;
    }
    const navigation = root.createDiv({ cls: "pdfaw-sidebar-actions" });
    this.action(navigation, "chevron-left", "Previous page", () => context.jump(context.page - 1)).disabled = context.page <= 1;
    navigation.createSpan({ text: `Page ${context.page} / ${context.pages}` });
    this.action(navigation, "chevron-right", "Next page", () => context.jump(context.page + 1)).disabled = context.page >= context.pages;
    const comments = context.annotations.filter(annotation => annotation.page === context.page);
    if (!comments.length) root.createEl("p", { cls: "pdfaw-sidebar-empty", text: "No comments on this page yet." });
    for (const annotation of comments) {
      const category = this.categories.forAnnotation(annotation);
      const item = root.createDiv({ cls: "pdfaw-sidebar-comment", attr: { "data-id": annotation.id } });
      item.setCssProps({ "--category": category.hex });
      item.createDiv({ cls: "pdfaw-preview-category", text: category.label });
      if (annotation.title) item.createEl("h4", { text: annotation.title });
      if (annotation.comment) item.createDiv({ cls: "pdfaw-preview-body", text: annotation.comment });
      item.createEl("blockquote", { text: annotation.text });
      if (annotation.tags?.length) item.createDiv({ cls: "pdfaw-preview-tags", text: annotation.tags.join(" · ") });
      const actions = item.createDiv({ cls: "pdfaw-sidebar-actions" });
      this.action(actions, "pencil", "Edit comment", () => context.edit(annotation));
      this.action(actions, "trash-2", "Delete comment", () => context.remove(annotation));
    }
  }
  private action(parent: HTMLElement, icon: string, label: string, click: () => void) {
    const button = parent.createEl("button", { attr: { type: "button", "aria-label": label } });
    setIcon(button, icon); button.onclick = click; return button;
  }
}

export class Sidebars {
  context: SidebarContext | null = null;
  constructor(private app: App) {}
  update(context: SidebarContext | null) {
    this.context = context;
    for (const type of [COMMENTS_VIEW, PAGES_VIEW]) for (const leaf of this.app.workspace.getLeavesOfType(type)) if (leaf.view instanceof PdfSidebar) leaf.view.render();
  }
  async show(type: typeof COMMENTS_VIEW | typeof PAGES_VIEW) {
    const leaf = this.app.workspace.getLeavesOfType(type)[0] ?? (type === COMMENTS_VIEW ? this.app.workspace.getRightLeaf(false) : this.app.workspace.getLeftLeaf(false));
    if (!leaf) return;
    if (leaf.view.getViewType() !== type) await leaf.setViewState({ type, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }
}
