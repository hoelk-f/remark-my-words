import { App, Notice, TextFileView, TFile, WorkspaceLeaf } from "obsidian";
import { Annotation, Sidecar, readSidecar } from "./model";
import { CategoryStore } from "./category-store";
import { CanvasData, PageSize, arrangeCanvas, readCanvas, updateCanvas } from "./canvas-model";
import { COMMENTS_VIEW, PAGES_VIEW, Sidebars } from "./sidebar";

type OpenReader = (file: TFile, page: number, annotation?: Annotation, remove?: boolean) => Promise<void>;
export class NativeCanvas {
  private actions = new Map<TextFileView, HTMLElement[]>();
  private page = new Map<string, number>();
  private revision = 0;
  private busy = false;
  constructor(private app: App, private categories: CategoryStore, private sidebars: Sidebars, private read: OpenReader) {}
  destroy() { this.revision++; this.actions.forEach(elements => elements.forEach(el => el.remove())); this.actions.clear(); }
  cancelActivation() { this.revision++; }
  owns(leaf: WorkspaceLeaf | null) {
    const view = this.view(leaf); if (!view) return false;
    try { readCanvas(view.getViewData()); return true; } catch { return false; }
  }
  pruneActions() {
    const live = new Set(this.app.workspace.getLeavesOfType("canvas").map(leaf => leaf.view));
    for (const [view, elements] of this.actions) if (!live.has(view)) { elements.forEach(el => el.remove()); this.actions.delete(view); }
  }
  private view(leaf: WorkspaceLeaf | null): TextFileView | null { return leaf?.view instanceof TextFileView && leaf.view.getViewType() === "canvas" ? leaf.view : null; }
  private live(path: string) { return this.app.workspace.getLeavesOfType("canvas").map(leaf => this.view(leaf)).find(view => view?.file?.path === path) ?? null; }

  async open(file: TFile, sidecar: Sidecar, pages: PageSize[]) {
    if (this.busy) return;
    this.busy = true;
    try {
      const path = `${file.path}.remark.canvas`;
      let target = this.app.vault.getAbstractFileByPath(path);
      const live = this.live(path);
      if (target && !(target instanceof TFile)) throw new Error("The canvas path is already used by a folder.");
      if (target instanceof TFile) {
        const old = readCanvas(live ? live.getViewData() : await this.app.vault.read(target), file.path);
        const next = updateCanvas(old, sidecar, pages, annotation => this.categories.forAnnotation(annotation), this.app.vault.getName());
        if (live) await this.write(live, next);
        else await this.app.vault.process(target, raw => JSON.stringify(updateCanvas(readCanvas(raw, file.path), sidecar, pages, annotation => this.categories.forAnnotation(annotation), this.app.vault.getName()), null, 2));
      } else {
        target = await this.app.vault.create(path, JSON.stringify(updateCanvas(null, sidecar, pages, annotation => this.categories.forAnnotation(annotation), this.app.vault.getName()), null, 2));
      }
      const leaf = live?.leaf ?? this.app.workspace.getLeaf("tab");
      if (!(target instanceof TFile)) throw new Error("The canvas file could not be created.");
      await leaf.openFile(target);
      await this.app.workspace.revealLeaf(leaf);
      this.app.workspace.setActiveLeaf(leaf, { focus: true });
      if (!this.view(leaf)) throw new Error("Enable the Canvas core plugin in Obsidian to open this canvas.");
      await this.activate(leaf);
      await this.sidebars.show(PAGES_VIEW);
      this.jump(leaf, this.page.get(path) ?? 1);
    } catch (error) { this.report(error); }
    finally { this.busy = false; }
  }

  async activate(leaf: WorkspaceLeaf | null) {
    const view = this.view(leaf), token = ++this.revision;
    if (!view?.file) return false;
    let data: CanvasData;
    try { data = readCanvas(view.getViewData()); } catch { return false; }
    const pdf = this.app.vault.getAbstractFileByPath(data.remarkMyWords.pdfPath);
    if (!(pdf instanceof TFile)) { this.sidebars.update(null); return false; }
    if (!this.actions.has(view)) {
      const elements = [
        view.addAction("book-open", "Read and annotate PDF", () => { void this.read(pdf, this.page.get(view.file!.path) ?? 1); }),
        view.addAction("files", "PDF pages", () => { void this.activate(view.leaf).then(() => this.sidebars.show(PAGES_VIEW)); }),
        view.addAction("messages-square", "Read page comments", () => { void this.activate(view.leaf).then(() => this.sidebars.show(COMMENTS_VIEW)); }),
        view.addAction("layout-dashboard", "Rearrange pages and comments", () => { void this.rearrange(view.leaf); }),
        view.addAction("refresh-cw", "Refresh comments from PDF", () => { void this.refresh(view.leaf); }),
      ];
      this.actions.set(view, elements);
    }
    try {
      const sidecar = await this.sidecar(pdf);
      if (token !== this.revision) return true;
      this.sidebars.update({
        owner: view, name: pdf.name, page: this.page.get(view.file.path) ?? 1, pages: data.remarkMyWords.pages.length, annotations: sidecar.annotations,
        jump: page => this.jump(view.leaf, page), edit: annotation => { void this.read(pdf, annotation.page, annotation); }, remove: annotation => { void this.read(pdf, annotation.page, annotation, true); },
        rearrange: () => { void this.rearrange(view.leaf); }, refresh: () => { void this.refresh(view.leaf); }, read: () => { void this.read(pdf, this.page.get(view.file!.path) ?? 1); },
      });
    } catch (error) { this.report(error); }
    return true;
  }
  private async sidecar(file: TFile): Promise<Sidecar> {
    const saved = this.app.vault.getAbstractFileByPath(`${file.path}.obsidian-annot.json`);
    return saved instanceof TFile ? readSidecar(await this.app.vault.read(saved), file.path) : { version: 2, pdfPath: file.path, annotations: [], notes: "" };
  }
  jump(leaf: WorkspaceLeaf, page: number) {
    const view = this.view(leaf); if (!view?.file) return;
    try {
      const data = readCanvas(view.getViewData());
      if (page < 1 || page > data.remarkMyWords.pages.length) return;
      const node = data.nodes.find(node => node.remarkMyWords?.page === page && !node.remarkMyWords.annotation);
      if (!node) { new Notice("This page card was removed from the canvas."); return; }
      // Obsidian exposes Canvas as a TextFileView, but viewport navigation is
      // still internal. Keep the single optional method behind a runtime guard.
      const canvas: unknown = Reflect.get(view, "canvas");
      if (typeof canvas !== "object" || canvas === null || !("zoomToBbox" in canvas) || typeof canvas.zoomToBbox !== "function") { new Notice("Page navigation is unavailable in this Obsidian version. Use canvas zoom to selection."); return; }
      (canvas as { zoomToBbox: (bounds: { minX: number; minY: number; maxX: number; maxY: number }) => void }).zoomToBbox({ minX: node.x, minY: node.y, maxX: node.x + node.width, maxY: node.y + node.height });
      this.page.set(view.file.path, page); void this.activate(leaf);
    } catch (error) { this.report(error); }
  }
  async rearrange(leaf: WorkspaceLeaf) {
    const view = this.view(leaf); if (!view || this.busy) return;
    this.busy = true;
    try { await this.write(view, arrangeCanvas(readCanvas(view.getViewData()))); this.jump(leaf, this.page.get(view.file!.path) ?? 1); }
    catch (error) { this.report(error); } finally { this.busy = false; }
  }
  async refresh(leaf: WorkspaceLeaf) {
    const view = this.view(leaf); if (!view || this.busy) return;
    this.busy = true;
    try {
      const initial = readCanvas(view.getViewData());
      const file = this.app.vault.getAbstractFileByPath(initial.remarkMyWords.pdfPath); if (!(file instanceof TFile)) throw new Error("The source PDF was not found.");
      const source = await this.sidecar(file);
      // Read live data again after I/O, keeping moves/edits made in the meantime.
      const current = readCanvas(view.getViewData(), file.path);
      await this.write(view, updateCanvas(current, source, current.remarkMyWords.pages, annotation => this.categories.forAnnotation(annotation), this.app.vault.getName()));
      await this.activate(leaf);
    } catch (error) { this.report(error); } finally { this.busy = false; }
  }
  private async write(view: TextFileView, data: CanvasData) {
    const before = view.getViewData(), after = JSON.stringify(data, null, 2);
    if (JSON.stringify(JSON.parse(before)) === JSON.stringify(data)) return;
    // Canvas commits history on a debounce. Record any immediate native move
    // before our edit, so one Undo returns to exactly the user's live layout.
    view.setViewData(before, false);
    view.setViewData(after, false);
    await view.save();
  }
  private report(error: unknown) { new Notice(`Could not update PDF canvas: ${error instanceof Error ? error.message : String(error)}`); console.error("Remark My Words: canvas", error); }
}
