import { App, Modal, setIcon } from "obsidian";
import { CategoryDefinition } from "./model";
import { CATEGORY_ICONS, CategoryStore } from "./category-store";

export class CategoryModal extends Modal {
  private draft: CategoryDefinition[];
  private revision: number;
  private list!: HTMLDivElement;
  private error!: HTMLDivElement;
  private add!: HTMLButtonElement;
  private accentInput!: HTMLInputElement;
  private accentColor: string;
  private saving = false;
  constructor(app: App, private store: CategoryStore) {
    super(app); this.draft = store.all(); this.revision = store.revision; this.accentColor = store.accentColor();
  }
  onOpen() {
    this.setTitle("Customize");
    this.modalEl.addClass("pdfaw-category-modal");
    this.contentEl.createEl("p", { cls: "pdfaw-category-help", text: "Categories apply to every PDF in this vault. Deleted categories remain on existing comments, but cannot be chosen for new comments." });
    const accent = this.contentEl.createDiv({ cls: "pdfaw-accent-setting" });
    accent.createEl("label", { text: "Accent color", attr: { for: "pdfaw-accent-color" } });
    this.accentInput = accent.createEl("input", { attr: { id: "pdfaw-accent-color", type: "color", "aria-label": "Accent color" } });
    this.accentInput.value = this.accentColor; this.accentInput.oninput = () => { this.accentColor = this.accentInput.value; };
    this.list = this.contentEl.createDiv({ cls: "pdfaw-category-list" });
    this.error = this.contentEl.createDiv({ cls: "pdfaw-category-error", attr: { role: "alert", tabindex: "-1" } });
    this.add = this.contentEl.createEl("button", { text: "Add category", attr: { type: "button" } });
    this.add.onclick = () => {
      if (this.saving) return;
      const item: CategoryDefinition = { id: `custom-${crypto.randomUUID()}`, label: "", color: "#54b5ff", hex: "#54b5ff", icon: "tag" };
      this.draft.push(item); this.render();
      this.list.querySelector<HTMLInputElement>(`[data-category-id="${item.id}"] input[type="text"]`)?.focus();
    };
    const actions = this.contentEl.createDiv({ cls: "pdfaw-category-actions" });
    const cancel = actions.createEl("button", { text: "Cancel", attr: { type: "button" } });
    cancel.onclick = () => this.close();
    const save = actions.createEl("button", { text: "Save categories", cls: "mod-cta", attr: { type: "button" } });
    save.onclick = () => { void this.save(); };
    this.render();
  }
  private render() {
    this.list.empty();
    const active = this.draft.filter(item => !item.archived);
    for (const item of active) {
      const row = this.list.createDiv({ cls: "pdfaw-category-row", attr: { "data-category-id": item.id } });
      const preview = row.createSpan({ cls: "pdfaw-category-preview", attr: { "aria-hidden": "true" } });
      preview.setCssProps({ "--category": item.hex }); setIcon(preview, item.icon);
      const field = (label: string, cls: string) => {
        const el = row.createDiv({ cls });
        el.createEl("label", { text: label, attr: { for: `${item.id}-${cls}` } });
        return { el, id: `${item.id}-${cls}` };
      };
      const name = field("Name", "pdfaw-category-name");
      const input = name.el.createEl("input", { attr: { id: name.id, type: "text", maxlength: "60", placeholder: "Category name" } });
      input.value = item.label; input.oninput = () => { item.label = input.value; };
      const color = field("Color", "pdfaw-category-color");
      const picker = color.el.createEl("input", { attr: { id: color.id, type: "color" } });
      picker.value = item.hex; picker.oninput = () => { item.hex = picker.value; item.color = picker.value; preview.setCssProps({ "--category": item.hex }); };
      const symbol = field("Icon", "pdfaw-category-icon");
      const select = symbol.el.createEl("select", { attr: { id: symbol.id } });
      for (const icon of [...new Set([...Object.keys(CATEGORY_ICONS), item.icon])]) select.createEl("option", { text: CATEGORY_ICONS[icon] ?? "Custom icon", attr: { value: icon } });
      select.value = item.icon; select.onchange = () => { item.icon = select.value; setIcon(preview, item.icon); };
      const remove = row.createEl("button", { cls: "pdfaw-category-delete", attr: { type: "button", "aria-label": `Delete ${item.label || "category"}`, title: active.length === 1 ? "Keep at least one category" : "Delete category" } });
      setIcon(remove, "trash-2"); remove.disabled = active.length === 1;
      remove.onclick = () => {
        if (this.saving) return;
        if (this.store.all().some(existing => existing.id === item.id)) item.archived = true;
        else this.draft = this.draft.filter(existing => existing.id !== item.id);
        this.render(); this.add.focus();
      };
    }
  }
  private async save() {
    if (this.saving) return;
    const unnamed = this.draft.find(item => !item.archived && !item.label.trim());
    if (unnamed) {
      this.error.setText("Give every category a name.");
      this.list.querySelector<HTMLInputElement>(`[data-category-id="${unnamed.id}"] input[type="text"]`)?.focus();
      return;
    }
    this.error.setText(""); this.saving = true;
    this.contentEl.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>("input, button, select").forEach(el => { el.disabled = true; });
    try { await this.store.save(this.draft, this.revision, this.accentColor); this.close(); }
    catch (error) {
      this.error.setText(error instanceof Error ? error.message : "Could not save categories. Try again.");
      this.contentEl.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>("input, button, select").forEach(el => { el.disabled = false; });
      this.render(); this.error.focus();
    } finally { this.saving = false; }
  }
  onClose() { this.contentEl.empty(); }
}
