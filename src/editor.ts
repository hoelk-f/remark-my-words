import { App, Modal, Setting } from "obsidian";
import { Annotation, Category, CategoryDefinition } from "./model";
import type { ThemeColors } from "./category-store";
import { applyModalTheme } from "./modal";

export type CommentDraft = Pick<Annotation, "title" | "comment" | "tags" | "category">;

export class CommentModal extends Modal {
  constructor(app: App, private draft: CommentDraft, private quote: string, private submit: (draft: CommentDraft) => void, private categories: CategoryDefinition[], private theme: ThemeColors) {
    super(app);
  }

  onOpen() {
    applyModalTheme(this, this.theme);
    this.setTitle(this.draft.title ? "Edit comment" : "Add comment");
    this.contentEl.addClass("pdfaw-editor");
    const draft = { ...this.draft };
    this.contentEl.createEl("blockquote", { text: this.quote });
    new Setting(this.contentEl).setName("Category").addDropdown(select => {
      for (const category of this.categories) select.addOption(category.id, category.label);
      select.setValue(draft.category).onChange(value => { draft.category = value as Category; });
    });
    const fieldId = `pdfaw-comment-${crypto.randomUUID()}`;
    const titleField = this.contentEl.createDiv({ cls: "pdfaw-editor-field" });
    titleField.createEl("label", { text: "Title", attr: { for: `${fieldId}-title` } });
    const title = titleField.createEl("input", { attr: { id: `${fieldId}-title`, type: "text", placeholder: "Your thought in one sentence" } });
    title.value = draft.title ?? "";
    title.oninput = () => { draft.title = title.value; };
    const descriptionField = this.contentEl.createDiv({ cls: "pdfaw-editor-field" });
    descriptionField.createEl("label", { text: "Description", attr: { for: `${fieldId}-description` } });
    const body = descriptionField.createEl("textarea", { cls: "pdfaw-editor-body", attr: { id: `${fieldId}-description`, placeholder: "What would you like to note about this passage?", rows: "7" } });
    body.value = draft.comment ?? "";
    body.oninput = () => { draft.comment = body.value; };
    const tagsField = this.contentEl.createDiv({ cls: "pdfaw-editor-field" });
    const tagsHeading = tagsField.createDiv({ cls: "pdfaw-field-heading" });
    tagsHeading.createEl("label", { text: "Tags", attr: { for: `${fieldId}-tags` } });
    tagsHeading.createSpan({ cls: "pdfaw-field-hint", text: "Separate with commas", attr: { id: `${fieldId}-tags-hint` } });
    const tags = tagsField.createEl("input", { attr: { id: `${fieldId}-tags`, type: "text", placeholder: "Method, research", "aria-describedby": `${fieldId}-tags-hint` } });
    tags.value = draft.tags?.join(", ") ?? "";
    tags.oninput = () => { draft.tags = [...new Set(tags.value.split(",").map(tag => tag.trim()).filter(Boolean))]; };
    const save = () => {
      this.submit({ ...draft, title: draft.title?.trim(), comment: draft.comment?.trim() });
      this.close();
    };
    new Setting(this.contentEl)
      .addButton(button => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton(button => button.setButtonText("Save").setCta().onClick(save));
    body.onkeydown = event => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); save(); } };
    title.focus();
  }

  onClose() { this.contentEl.empty(); }
}
