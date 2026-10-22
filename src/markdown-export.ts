import type { Vault } from "obsidian";
import type { Annotation, Sidecar } from "./model";

export type ExportComment = Annotation & { categoryLabel: string };
export type ExportSnapshot = { pdfPath: string; vaultName: string; notes: string; comments: ExportComment[] };
export type ExportOptions = { mode: "combined" | "individual"; folder: string; name: string; includeNotes: boolean };
type ExportVault = Pick<Vault, "getAbstractFileByPath" | "getAllLoadedFiles" | "createFolder" | "create">;

/** Resolve stored records, including filtered and virtualized cards, exactly once. */
export function selectedComments(data: Sidecar, selected: ReadonlySet<string>): Annotation[] {
  const keys = new Set(selected);
  for (const group of data.canvasLayout?.groups ?? []) if (keys.has(`g:${group.id}`)) group.members.forEach(key => keys.add(key));
  return data.annotations.filter(a => keys.has(`a:${a.id}`) || keys.has(`p:${a.page}`))
    .sort((a, b) => a.page - b.page || a.quads[0].y - b.quads[0].y || a.quads[0].x - b.quads[0].x || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

const invalidCharacter = (value: string) => /[<>:"/\\|?*#[\]^]/.test(value) || [...value].some(char => char.charCodeAt(0) < 32);
const reservedName = (value: string) => /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value);
const validPart = (value: string) => !!value && !value.startsWith(".") && !/[. ]$/.test(value) && !invalidCharacter(value) && !reservedName(value);
const encoder = new TextEncoder();
function truncateName(value: string) {
  let result = "", bytes = 0;
  for (const char of value) { bytes += encoder.encode(char).length; if (bytes > 140) break; result += char; }
  return result.replace(/[. ]+$/, "");
}
export function safeExportName(value: string): string {
  let name = [...value].map(char => invalidCharacter(char) ? "-" : char).join("").replace(/\s+/g, " ").replace(/^\.+/, "").trim();
  if (reservedName(name)) name = `_${name}`;
  return truncateName(name) || "Comments";
}
export function exportFolder(value: string): string {
  const folder = value.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!folder) { if (value.trim()) throw new Error("Choose a folder inside the vault, or leave it empty for the vault root."); return ""; }
  if (folder.split("/").some(part => !validPart(part))) throw new Error("Use a folder inside the vault without hidden folders, relative paths or special characters.");
  return folder;
}
export function exportFileName(value: string): string {
  const name = value.trim().replace(/\.md$/i, "");
  if (!validPart(name) || encoder.encode(name).length > 180) throw new Error("Use a short file name without folders or special characters.");
  return name;
}
const lines = (text: string) => text.replace(/\r\n?/g, "\n");
const escaped = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/([\\`*_{}[\]()#+.!|~^-])/g, "\\$1");
const inline = (text: string) => escaped(text.replace(/\s+/g, " ").trim());
const encoded = (text: string) => encodeURIComponent(text).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
function pdfLink(snapshot: ExportSnapshot, folder: string, page?: number) {
  const source = snapshot.pdfPath.split("/"), target = folder ? folder.split("/") : [];
  while (target.length && source.length > 1 && target[0] === source[0]) { target.shift(); source.shift(); }
  const path = [...target.map(() => ".."), ...source].map(encoded).join("/");
  const label = page ? `PDF · page ${page}` : snapshot.pdfPath.split("/").pop()!;
  return `[${inline(label)}](<${path}${page ? `#page=${page}` : ""}>)`;
}
function commentBody(snapshot: ExportSnapshot, annotation: ExportComment, folder: string) {
  const uri = `obsidian://remark-my-words?vault=${encoded(snapshot.vaultName)}&file=${encoded(snapshot.pdfPath)}&page=${annotation.page}&comment=${encoded(annotation.id)}`;
  const parts = [`Source: ${pdfLink(snapshot, folder, annotation.page)} · [Open comment](<${uri}>)`, `Category: ${inline(annotation.categoryLabel)}`];
  if (annotation.tags?.length) parts.push(`Tags: ${annotation.tags.map(inline).join(", ")}`);
  if (annotation.text.trim()) parts.push(lines(annotation.text).split("\n").map(line => `> ${escaped(line)}`).join("\n"));
  if (annotation.comment?.trim()) parts.push(lines(annotation.comment).trim());
  return parts.join("\n\n");
}
export function markdownFiles(snapshot: ExportSnapshot, options: ExportOptions): { name: string; content: string }[] {
  if (!snapshot.comments.length) throw new Error("Select at least one comment or a page containing comments.");
  const folder = exportFolder(options.folder), title = snapshot.pdfPath.split("/").pop()!.replace(/\.pdf$/i, "");
  const notes = options.includeNotes ? lines(snapshot.notes).trim() : "";
  if (options.mode === "individual") {
    const files = snapshot.comments.map((a, index) => ({
      name: `${safeExportName(`Page ${a.page} - ${a.title?.trim() || `Comment ${index + 1}`}`)}.md`,
      content: `# ${inline(a.title?.trim() || `Comment ${index + 1}`)}\n\n${commentBody(snapshot, a, folder)}\n`,
    }));
    if (notes) files.push({ name: "Document notes.md", content: `# ${inline(title)} — Document notes\n\nSource: ${pdfLink(snapshot, folder)}\n\n${notes}\n` });
    return files;
  }
  const parts = [`# ${inline(title)} — Comments`, `Source: ${pdfLink(snapshot, folder)}`];
  if (notes) parts.push(`## Document notes\n\n${notes}`);
  let page = 0;
  const headings = new Set<string>();
  snapshot.comments.forEach((annotation, index) => {
    if (annotation.page !== page) { page = annotation.page; parts.push(`## Page ${page}`); }
    const base = inline(annotation.title?.trim() || `Comment ${index + 1}`);
    let heading = base, suffix = 2;
    while (headings.has(heading.toLowerCase())) heading = `${base} (${suffix++})`;
    headings.add(heading.toLowerCase());
    parts.push(`### ${heading}\n\n${commentBody(snapshot, annotation, folder)}`);
  });
  return [{ name: `${exportFileName(options.name)}.md`, content: parts.join("\n\n") + "\n" }];
}

/** Keep completed files when a write fails; retry resumes without exporting them twice. */
export class MarkdownExportJob {
  readonly written: string[] = [];
  readonly files: { name: string; content: string }[];
  folder: string;
  constructor(private snapshot: ExportSnapshot, private options: ExportOptions) {
    this.folder = exportFolder(options.folder);
    this.files = markdownFiles(snapshot, { ...options, folder: this.folder });
  }
  async run(vault: ExportVault, progress: (done: number, total: number) => void = () => {}) {
    const loaded = new Map(vault.getAllLoadedFiles().map(file => [file.path.toLowerCase(), file]));
    let folder = "";
    for (const part of this.folder.split("/").filter(Boolean)) {
      const path = folder ? `${folder}/${part}` : part;
      let existing = vault.getAbstractFileByPath(path) ?? loaded.get(path.toLowerCase());
      if (!existing) {
        try { existing = await vault.createFolder(path); }
        catch (error) { existing = vault.getAbstractFileByPath(path) ?? undefined; if (!existing) throw error; }
      }
      if (!("children" in existing)) throw new Error(`A file already uses the folder name: ${path}`);
      folder = existing.path;
    }
    if (this.folder !== folder) {
      const rendered = markdownFiles(this.snapshot, { ...this.options, folder });
      this.files.forEach((file, index) => { file.content = rendered[index].content; });
    }
    this.folder = folder;
    for (let index = this.written.length; index < this.files.length; index++) {
      const file = this.files[index], stem = file.name.slice(0, -3);
      let suffix = 1;
      while (true) {
        const name = suffix === 1 ? file.name : `${stem} (${suffix}).md`;
        const path = folder ? `${folder}/${name}` : name;
        suffix++;
        if (vault.getAbstractFileByPath(path) || loaded.has(path.toLowerCase())) continue;
        try {
          const created = await vault.create(path, file.content);
          loaded.set(path.toLowerCase(), created); this.written.push(path); break;
        } catch (error) {
          if (!vault.getAbstractFileByPath(path)) throw error;
        }
      }
      progress(this.written.length, this.files.length);
    }
    return this.written;
  }
}
