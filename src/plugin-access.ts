import { App, FuzzySuggestModal, Plugin, PluginSettingTab, Setting, TFile } from "obsidian";
import { CategoryStore } from "./category-store";
import { CategoryModal } from "./category-modal";

export class PdfPicker extends FuzzySuggestModal<TFile> {
  constructor(app: App, private choose: (file: TFile) => void) {
    super(app); this.setPlaceholder("Choose a PDF from this vault");
  }
  getItems() { return this.app.vault.getFiles().filter(file => file.extension.toLowerCase() === "pdf").sort((a, b) => a.path.localeCompare(b.path)); }
  getItemText(file: TFile) { return file.path; }
  onChooseItem(file: TFile) { this.choose(file); }
}

export class RemarkSettingsTab extends PluginSettingTab {
  constructor(app: App, plugin: Plugin, private categories: CategoryStore, private openPdf: () => void) { super(app, plugin); }
  getSettingDefinitions() {
    return [
      { name: "Open PDF", desc: "Open the active PDF or choose one from this vault.",
        render: (setting: Setting) => { setting.addButton(button => button.setButtonText("Open PDF").onClick(this.openPdf)); } },
      { name: "Categories", desc: "Edit the names, colors, and icons used across all PDFs in this vault.",
        render: (setting: Setting) => { setting.addButton(button => button.setButtonText("Customize").onClick(() => new CategoryModal(this.app, this.categories).open())); } },
    ];
  }
}
