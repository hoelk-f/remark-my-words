import { App, Modal } from "obsidian";
import type { ThemeColors } from "./category-store";
import { applyThemeColors } from "./theme";

export function applyModalTheme(modal: Modal, theme: ThemeColors) {
  modal.modalEl.addClass("pdfaw-modal");
  applyThemeColors(modal.modalEl, theme);
}

export class DeleteCommentModal extends Modal {
  constructor(app: App, private label: string, private theme: ThemeColors, private confirm: () => void) { super(app); }

  onOpen() {
    applyModalTheme(this, this.theme);
    this.modalEl.addClass("pdfaw-delete-modal");
    this.setTitle("Delete comment?");
    this.contentEl.createEl("p", { text: "This comment and its highlight will be removed. This cannot be undone." });
    this.contentEl.createEl("blockquote", { cls: "pdfaw-delete-summary", text: this.label });
    const actions = this.contentEl.createDiv({ cls: "pdfaw-modal-actions" });
    const cancel = actions.createEl("button", { text: "Cancel", attr: { type: "button" } });
    cancel.onclick = () => this.close();
    const remove = actions.createEl("button", { text: "Delete", cls: "mod-warning", attr: { type: "button" } });
    remove.onclick = () => { this.close(); this.confirm(); };
    cancel.focus();
  }

  onClose() { this.contentEl.empty(); }
}

export class GroupNameModal extends Modal {
  constructor(app: App, private name: string, private theme: ThemeColors, private submit: (name: string) => void) { super(app); }
  onOpen() {
    applyModalTheme(this, this.theme); this.setTitle(this.name ? "Rename group" : "Create group");
    const id = `pdfaw-group-${crypto.randomUUID()}`;
    this.contentEl.createEl("label", { text: "Group name", attr: { for: id } });
    const input = this.contentEl.createEl("input", { cls: "pdfaw-group-name", attr: { id, type: "text", maxlength: "100", placeholder: "Group name" } }); input.value = this.name;
    const actions = this.contentEl.createDiv({ cls: "pdfaw-modal-actions" });
    actions.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const save = () => { const name = input.value.trim(); if (!name) { input.focus(); return; } this.submit(name); this.close(); };
    actions.createEl("button", { text: "Save", cls: "mod-cta" }).onclick = save;
    input.onkeydown = event => { if (event.key === "Enter") { event.preventDefault(); save(); } };
    input.focus(); input.select();
  }
  onClose() { this.contentEl.empty(); }
}
