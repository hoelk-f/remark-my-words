import { App, Modal, Notice } from "obsidian";
import type { ThemeColors } from "./category-store";
import { applyModalTheme } from "./modal";
import { ExportSnapshot, MarkdownExportJob, safeExportName } from "./markdown-export";

export class ExportModal extends Modal {
  private busy = false;
  private job: MarkdownExportJob | null = null;
  constructor(app: App, private snapshot: ExportSnapshot, private theme: ThemeColors) { super(app); }
  onOpen() {
    applyModalTheme(this, this.theme); this.modalEl.addClass("pdfaw-export-modal"); this.setTitle("Export selection");
    const count = this.snapshot.comments.length, pages = new Set(this.snapshot.comments.map(a => a.page)).size;
    this.contentEl.createEl("p", { cls: "pdfaw-export-summary", text: `${count} ${count === 1 ? "comment" : "comments"} from ${pages} ${pages === 1 ? "page" : "pages"}. Selected pages include all their comments, including filtered comments.` });
    const id = `pdfaw-export-${crypto.randomUUID()}`;
    const field = (label: string, key: string) => {
      const el = this.contentEl.createDiv({ cls: "pdfaw-export-field" });
      el.createEl("label", { text: label, attr: { for: `${id}-${key}` } });
      return { el, id: `${id}-${key}` };
    };
    const formatField = field("Format", "format");
    const format = formatField.el.createEl("select", { cls: "pdfaw-export-format", attr: { id: formatField.id } });
    format.createEl("option", { text: "One combined file (.md)", attr: { value: "combined" } });
    format.createEl("option", { text: "One file per comment (.md)", attr: { value: "individual" } });
    const sourceName = safeExportName(this.snapshot.pdfPath.split("/").pop()!.replace(/\.pdf$/i, ""));
    const parent = this.snapshot.pdfPath.includes("/") ? this.snapshot.pdfPath.slice(0, this.snapshot.pdfPath.lastIndexOf("/")) + "/" : "";
    const folderField = field("Folder in vault", "folder");
    const folder = folderField.el.createEl("input", { cls: "pdfaw-export-folder", attr: { id: folderField.id, type: "text", placeholder: "Leave empty for the vault root" } });
    folder.value = `${parent}${sourceName} - Notes`;
    const nameField = field("File name", "name");
    const name = nameField.el.createEl("input", { cls: "pdfaw-export-name", attr: { id: nameField.id, type: "text" } });
    name.value = safeExportName(`${sourceName} - Comments`);
    const notesLabel = this.contentEl.createEl("label", { cls: "pdfaw-export-notes-label" });
    const notes = notesLabel.createEl("input", { cls: "pdfaw-export-notes", attr: { type: "checkbox" } });
    notesLabel.createSpan({ text: "Include document notes" });
    notes.disabled = !this.snapshot.notes.trim();
    const hint = this.contentEl.createEl("p", { cls: "pdfaw-export-hint" });
    const describe = () => {
      nameField.el.hidden = format.value === "individual";
      hint.setText(format.value === "individual" ? "Each comment becomes a note. Included document notes get a separate file." : "Comments are grouped by PDF page, each with its own heading.");
    };
    format.onchange = describe; describe();
    this.contentEl.createEl("p", { cls: "pdfaw-export-hint", text: "Exports are independent copies. If a name is already used, the export gets a numbered name. Changes to exported notes do not update PDF comments." });
    const status = this.contentEl.createDiv({ cls: "pdfaw-export-status", attr: { role: "status", "aria-live": "polite" } });
    const error = this.contentEl.createDiv({ cls: "pdfaw-export-error", attr: { role: "alert" } });
    const actions = this.contentEl.createDiv({ cls: "pdfaw-modal-actions" });
    const cancel = actions.createEl("button", { text: "Cancel", attr: { type: "button" } }); cancel.onclick = () => this.close();
    const submit = actions.createEl("button", { text: "Export", cls: "mod-cta", attr: { type: "button" } });
    const lock = (value: boolean) => { format.disabled = folder.disabled = name.disabled = value; notes.disabled = value || !this.snapshot.notes.trim(); };
    submit.onclick = () => { void (async () => {
      if (this.busy) return;
      this.busy = true; lock(true); cancel.disabled = submit.disabled = true; error.setText("");
      try {
        this.job ??= new MarkdownExportJob(this.snapshot, { mode: format.value === "individual" ? "individual" : "combined", folder: folder.value, name: name.value, includeNotes: notes.checked });
        status.setText("Exporting …");
        await this.job.run(this.app.vault, (done, total) => status.setText(`Exported ${done} of ${total} files …`));
        new Notice(`Exported ${count} ${count === 1 ? "comment" : "comments"} to ${this.job.written.length} Markdown ${this.job.written.length === 1 ? "file" : "files"} in ${this.job.folder || "the vault root"}.`);
        this.busy = false; this.close();
      } catch (cause) {
        const done = this.job?.written.length ?? 0;
        status.setText(done ? `${done} of ${this.job!.files.length} files exported. Retry continues with the remaining files.` : "No Markdown files exported.");
        error.setText(cause instanceof Error ? cause.message : "Could not export. Check the destination and try again.");
        if (!done) this.job = null;
        this.busy = false; lock(!!this.job); cancel.disabled = submit.disabled = false; submit.setText("Retry export");
      }
    })(); };
    format.focus();
  }
  close() { if (!this.busy) super.close(); }
  onClose() { this.contentEl.empty(); }
}
