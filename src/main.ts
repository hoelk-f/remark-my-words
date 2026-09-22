import { FileView, Menu, Notice, Plugin, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy, PDFDocumentLoadingTask, RenderTask } from "pdfjs-dist";
import { Annotation, Bounds, CARD_WIDTH, Category, PDF_SCALE, Point, Quad, Sidecar, connection, defaultPosition, fitCamera, readSidecar, sceneBounds } from "./model";
import { CommentDraft, CommentModal } from "./editor";
import { selectionQuads } from "./selection";
import { CommentPreview } from "./comment-preview";
import { CategoryStore, readCategorySettings } from "./category-store";
import { CategoryModal } from "./category-modal";
import { PdfPicker, RemarkSettingsTab } from "./plugin-access";
import workerSource from "embedded-pdf-worker";

const VIEW_TYPE = "pdfaw-view";
const SVG_NS = "http://www.w3.org/2000/svg";
function svg<K extends keyof SVGElementTagNameMap>(parent: Element, tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = parent.ownerDocument.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  parent.appendChild(el);
  return el;
}

export class PdfAnnotatorView extends FileView {
  private root!: HTMLDivElement;
  private viewport!: HTMLDivElement;
  private stage!: HTMLDivElement;
  private pageEl!: HTMLDivElement;
  private links!: SVGSVGElement;
  private cardsEl!: HTMLDivElement;
  private thumbnails!: HTMLDivElement;
  private noteInput!: HTMLTextAreaElement;
  private status!: HTMLDivElement;
  private saveStatus!: HTMLSpanElement;
  private pageInput!: HTMLInputElement;
  private pageTotal!: HTMLSpanElement;
  private zoomLabel!: HTMLButtonElement;
  private mode: "canvas" | "reading" = "canvas";
  private canvasCamera: typeof this.camera | null = null;
  private modeButtons = new Map<string, HTMLButtonElement>();
  private selectionBar!: HTMLDivElement;
  private commentPreview!: CommentPreview;
  private filterBar!: HTMLDivElement;
  private searchInput!: HTMLInputElement;
  private searchStatus!: HTMLSpanElement;
  private toolButtons = new Map<string, HTMLButtonElement>();
  private cards = new Map<string, HTMLDivElement>();
  private thumbButtons = new Map<number, HTMLButtonElement>();
  private sidecar: Sidecar | null = null;
  private pdf: PDFDocumentProxy | null = null;
  private loading: PDFDocumentLoadingTask | null = null;
  private workerUrl: string | null = null;
  private renderTasks = new Set<RenderTask>();
  private pageTask: RenderTask | null = null;
  private textLayer: pdfjs.TextLayer | null = null;
  private thumbObserver: IntersectionObserver | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private saveQueue: Promise<void> = Promise.resolve();
  private saveRevision = 0;
  private notesTimer: number | undefined;
  private generation = 0;
  private pageGeneration = 0;
  private searchGeneration = 0;
  private currentPage = 1;
  private pageWidth = 804;
  private pageHeight = 1137;
  private camera = { x: 0, y: 0, zoom: 0.7 };
  private tool: "select" | "hand" = "select";
  private filter: Category | null = null;
  private selection: { page: number; text: string; quads: Quad[] } | null = null;
  private selectionPointer: number | null = null;
  private commentPress: { pointer: number; start: Point; dragged: boolean } | null = null;
  private pageChangePending = false;
  private selectionBarOrientation: "horizontal" | "vertical" = "horizontal";
  private selectionBarPosition: Point | null = null;
  private selectionDrag: { pointer: number; start: Point; origin: Point } | null = null;
  private activeId: string | null = null;
  private gesture: { pointer: number; start: Point; origin: Point; card?: Annotation; element: HTMLElement } | null = null;
  private searchPages: number[] = [];
  private searchIndex = -1;
  private searchText = new Map<number, string>();
  private pageReady = false;
  private geometryFrame = 0;

  constructor(leaf: WorkspaceLeaf, private categories: CategoryStore) { super(leaf); }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return this.file?.name ?? "Remark My Words"; }
  getIcon() { return "file-pen-line"; }
  canAcceptExtension(extension: string) { return extension.toLowerCase() === "pdf"; }
  private get win() { return this.contentEl.ownerDocument.defaultView!; }

  private button(parent: HTMLElement, icon: string, label: string, action: () => void, cls = ""): HTMLButtonElement {
    const button = parent.createEl("button", { cls: `pdfaw-icon-button ${cls}`, attr: { "aria-label": label, type: "button" } });
    setIcon(button, icon); button.onclick = action;
    return button;
  }

  async onOpen() {
    this.contentEl.empty(); this.contentEl.addClass("pdfaw-content");
    this.root = this.contentEl.createDiv({ cls: "pdfaw-root", attr: { tabindex: "0" } });
    const toolbar = this.root.createDiv({ cls: "pdfaw-toolbar" });
    const search = toolbar.createDiv({ cls: "pdfaw-search" });
    setIcon(search.createSpan(), "search");
    this.searchInput = search.createEl("input", { attr: { type: "search", placeholder: "Search document …", "aria-label": "Search document" } });
    this.searchInput.onkeydown = event => {
      if (event.key === "Enter") { event.preventDefault(); void this.searchDocument(event.shiftKey ? -1 : 1); }
      if (event.key === "Escape") { this.searchInput.value = ""; this.clearSearch(); this.root.focus(); }
    };
    this.searchInput.oninput = () => this.clearSearch();
    this.searchStatus = search.createSpan({ cls: "pdfaw-search-status" });
    this.button(search, "chevron-down", "Next matching page", () => void this.searchDocument(1));

    const modes = toolbar.createDiv({ cls: "pdfaw-tool-group pdfaw-modes", attr: { "aria-label": "View mode" } });
    for (const mode of ["canvas", "reading"] as const) {
      const button = this.button(modes, mode === "canvas" ? "layout-dashboard" : "book-open", mode === "canvas" ? "Canvas mode" : "Reading mode", () => this.setMode(mode));
      button.setAttribute("aria-pressed", String(this.mode === mode)); this.modeButtons.set(mode, button);
    }
    const tools = toolbar.createDiv({ cls: "pdfaw-tool-group" });
    this.button(tools, "panel-left", "Toggle page sidebar", () => this.root.toggleClass("pdfaw-hide-pages", !this.root.hasClass("pdfaw-hide-pages")));
    for (const [key, icon, label] of [["select", "mouse-pointer-2", "Select text"], ["hand", "hand", "Pan canvas"]]) {
      this.toolButtons.set(key, this.button(tools, icon, label, () => this.setTool(key as "select" | "hand")));
    }
    this.button(tools, "message-square-plus", "Comment on selection", () => this.editSelection(this.categories.preferred()));
    const zoom = toolbar.createDiv({ cls: "pdfaw-tool-group pdfaw-zoom-controls" });
    this.button(zoom, "minus", "Zoom out", () => this.zoomBy(1 / 1.15));
    this.zoomLabel = zoom.createEl("button", { cls: "pdfaw-zoom-label", text: "100 %", attr: { "aria-label": "Zoom to 100 percent" } });
    this.zoomLabel.onclick = () => this.zoomBy(1 / this.camera.zoom);
    this.button(zoom, "plus", "Zoom in", () => this.zoomBy(1.15));
    this.button(zoom, "scan", "Fit PDF and comments", () => this.fit());
    const navigation = toolbar.createDiv({ cls: "pdfaw-tool-group pdfaw-navigation" });
    this.button(navigation, "chevron-left", "Previous page", () => void this.showPage(this.currentPage - 1));
    this.pageInput = navigation.createEl("input", { attr: { type: "number", min: "1", value: "1", "aria-label": "Page number" } });
    this.pageInput.onchange = () => { void this.showPage(Number(this.pageInput.value)); this.pageInput.value = String(this.currentPage); };
    this.pageTotal = navigation.createSpan({ text: "/ 0" });
    this.button(navigation, "chevron-right", "Next page", () => void this.showPage(this.currentPage + 1));
    const right = toolbar.createDiv({ cls: "pdfaw-tool-group pdfaw-toolbar-end" });
    const readComments = this.button(right, "messages-square", "Read page comments", () => {
      this.commentPreview.show(this.pageAnnotations(), readComments.getBoundingClientRect(), readComments);
    }, "pdfaw-read-comments");
    this.button(right, "layout-dashboard", "Rearrange cards on this page", () => this.rearrangeCards());
    this.button(right, "tags", "Customize", () => new CategoryModal(this.app, this.categories).open());
    this.button(right, "sticky-note", "Document notes", () => {
      this.root.toggleClass("pdfaw-show-notes", !this.root.hasClass("pdfaw-show-notes"));
      if (this.root.hasClass("pdfaw-show-notes")) this.noteInput.focus();
    });

    const body = this.root.createDiv({ cls: "pdfaw-body" });
    const sidebar = body.createDiv({ cls: "pdfaw-pages" });
    const pagesHeading = sidebar.createDiv({ cls: "pdfaw-panel-heading" });
    pagesHeading.createSpan({ text: "Pages" }); setIcon(pagesHeading.createSpan(), "panels-top-left");
    this.thumbnails = sidebar.createDiv({ cls: "pdfaw-thumbnails" });
    this.viewport = body.createDiv({ cls: "pdfaw-viewport" });
    this.stage = this.viewport.createDiv({ cls: "pdfaw-stage" });
    this.pageEl = this.stage.createDiv({ cls: "pdfaw-page" });
    this.links = svg(this.stage, "svg", { class: "pdfaw-connections", "aria-hidden": "true" });
    this.cardsEl = this.stage.createDiv({ cls: "pdfaw-cards" });
    this.filterBar = this.viewport.createDiv({ cls: "pdfaw-filters", attr: { "aria-label": "Filter comments by category" } });
    this.renderFilters();
    this.selectionBar = this.root.createDiv({ cls: "pdfaw-selection-toolbar", attr: { role: "toolbar", "aria-label": "Comment on selection" } });
    this.selectionBar.hidden = true;
    this.commentPreview = new CommentPreview(
      this.root,
      this.viewport,
      annotation => this.categories.forAnnotation(annotation),
      { edit: annotation => this.editAnnotation(annotation), remove: annotation => this.deleteAnnotation(annotation) }
    );
    this.renderCategoryTools();
    this.register(this.categories.subscribe(() => {
      this.renderCategoryTools(); this.renderFilters(); this.renderAnnotations(); this.positionSelectionBar();
    }));
    const notesPanel = body.createDiv({ cls: "pdfaw-notes-panel" });
    const notesHeading = notesPanel.createDiv({ cls: "pdfaw-panel-heading" });
    notesHeading.createSpan({ text: "Document notes" });
    this.button(notesHeading, "x", "Close notes", () => this.root.removeClass("pdfaw-show-notes"));
    this.noteInput = notesPanel.createEl("textarea", { attr: { placeholder: "Notes about this document …", "aria-label": "Document notes" } });
    this.noteInput.oninput = () => {
      if (!this.sidecar) return;
      this.sidecar.notes = this.noteInput.value; this.saveStatus.setText("Unsaved");
      this.win.clearTimeout(this.notesTimer);
      this.notesTimer = this.win.setTimeout(() => { this.notesTimer = undefined; void this.save(); }, 400);
    };
    const status = this.root.createDiv({ cls: "pdfaw-status", attr: { hidden: "true", "aria-live": "polite" } });
    this.status = status; this.saveStatus = status.createSpan({ text: "" });
    this.setTool("select");
    this.registerDomEvent(this.viewport, "pointerdown", event => this.startPan(event));
    this.registerDomEvent(this.pageEl, "pointerdown", event => {
      if (event.button === 0 && this.tool === "select" && this.pageReady) this.selectionPointer = event.pointerId;
      this.commentPress = this.mode === "reading" && event.button === 0
        ? { pointer: event.pointerId, start: { x: event.clientX, y: event.clientY }, dragged: false } : null;
    });
    this.registerDomEvent(this.viewport, "pointermove", event => this.moveGesture(event));
    this.registerDomEvent(this.contentEl.ownerDocument, "pointermove", event => {
      const press = this.commentPress;
      if (press?.pointer === event.pointerId && Math.hypot(event.clientX - press.start.x, event.clientY - press.start.y) > 4) press.dragged = true;
      this.moveSelectionBarDrag(event);
    });
    this.registerDomEvent(this.pageEl, "click", event => this.openCommentAt(event));
    this.registerDomEvent(this.contentEl.ownerDocument, "pointerdown", event => {
      if (!this.commentPreview.contains(event.target as Node | null)) this.commentPreview.hide();
    });
    this.registerDomEvent(this.viewport, "pointerup", event => { this.endGesture(event); if (this.selectionPointer === null) this.captureSelection(); });
    this.registerDomEvent(this.contentEl.ownerDocument, "pointerup", event => {
      this.endSelectionBarDrag(event);
      if (this.selectionPointer !== event.pointerId) return;
      this.selectionPointer = null; this.captureSelection();
    });
    this.registerDomEvent(this.contentEl.ownerDocument, "pointercancel", event => {
      if (this.commentPress?.pointer === event.pointerId) this.commentPress = null;
      if (this.selectionPointer !== event.pointerId) return;
      this.selectionPointer = null; this.clearSelection(); this.win.getSelection()?.removeAllRanges();
    });
    this.registerDomEvent(this.viewport, "pointercancel", event => this.endGesture(event));
    this.registerDomEvent(this.viewport, "scroll", () => { this.positionSelectionBar(); this.commentPreview.hide(); });
    this.registerDomEvent(this.pageEl, "keyup", () => this.captureSelection());
    this.registerDomEvent(this.contentEl.ownerDocument, "selectionchange", () => {
      // Update during the native drag, before release. The browser still owns
      // selection/copy semantics; only its overlapping span paint is replaced.
      this.captureSelection();
    });
    this.registerDomEvent(this.viewport, "wheel", event => {
      if ((event.target as HTMLElement).closest(".pdfaw-comment-body")) return;
      if (this.mode === "reading" && !event.ctrlKey && !event.metaKey) {
        const atBottom = this.viewport.scrollTop + this.viewport.clientHeight >= this.viewport.scrollHeight - 2;
        if (event.deltaY > 0 && atBottom && this.currentPage < (this.pdf?.numPages ?? 1) && !this.pageChangePending) {
          event.preventDefault(); this.pageChangePending = true;
          void this.showPage(this.currentPage + 1).finally(() => { this.pageChangePending = false; });
        }
        return;
      }
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) this.zoomBy(Math.exp(-event.deltaY * 0.005), { x: event.clientX, y: event.clientY });
      else { this.camera.x -= event.deltaX || (event.shiftKey ? event.deltaY : 0); this.camera.y -= event.shiftKey ? 0 : event.deltaY; this.applyCamera(); }
    }, { passive: false });
    this.registerDomEvent(this.pageEl, "contextmenu", event => {
      this.captureSelection(); if (!this.selection) return;
      event.preventDefault(); const menu = new Menu();
      for (const category of this.categories.active()) menu.addItem(item => item.setTitle(category.label).setIcon(category.icon).onClick(() => this.editSelection(category.id)));
      menu.showAtMouseEvent(event);
    });
    this.registerDomEvent(this.root, "keydown", event => this.onKey(event));
    this.registerDomEvent(this.contentEl.ownerDocument, "keydown", event => { if (event.key === "Escape") this.commentPreview.hide(); });
    this.resizeObserver = new ResizeObserver(entries => {
      if (this.mode === "reading") {
        // Rebuilding hidden canvas cards also sends resize notifications.
        // Only a viewport resize changes the Reading layout or its previews.
        if (entries.some(entry => entry.target === this.viewport)) this.applyCamera();
      } else this.queueGeometry();
    });
    this.resizeObserver.observe(this.viewport);
    this.register(() => this.resizeObserver?.disconnect());
  }

  private menuPosition(el: HTMLElement) { const box = el.getBoundingClientRect(); return { x: box.left, y: box.bottom }; }

  async onLoadFile(file: TFile) {
    if (!this.root) await this.onOpen();
    await this.flushNotes(); this.releaseDocument();
    const generation = this.generation;
    this.file = file; this.sidecar = null;
    this.noteInput.disabled = true; this.noteInput.value = "";
    this.pageEl.empty(); this.cardsEl.empty(); this.links.replaceChildren(); this.thumbnails.empty();
    this.pageEl.createDiv({ cls: "pdfaw-loading", text: "Loading PDF …" }); this.saveStatus.setText("Loading …");
    try {
      await this.saveQueue; if (generation !== this.generation) return;
      const path = `${file.path}.obsidian-annot.json`;
      const existing = this.app.vault.getAbstractFileByPath(path);
      const data = existing instanceof TFile ? readSidecar(await this.app.vault.read(existing), file.path) : { version: 2 as const, pdfPath: file.path, annotations: [], notes: "" };
      const buffer = await this.app.vault.readBinary(file);
      if (generation !== this.generation) return;
      // A local Blob uses the bundled worker with no network or extra asset.
      this.workerUrl ??= URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
      pdfjs.GlobalWorkerOptions.workerSrc = this.workerUrl;
      this.loading = pdfjs.getDocument({ data: buffer, isEvalSupported: false });
      const pdf = await this.loading.promise;
      if (generation !== this.generation) { void pdf.destroy(); return; }
      this.pdf = pdf; this.sidecar = data; this.renderFilters();
      this.noteInput.disabled = false; this.noteInput.value = data.notes; this.saveStatus.setText("Local to vault");
      this.pageTotal.setText(`/ ${pdf.numPages}`); this.pageInput.max = String(pdf.numPages);
      this.buildThumbnails(); await this.showPage(1);
    } catch (error) {
      if (generation !== this.generation) return;
      this.pageEl.empty();
      this.pageEl.createDiv({ cls: "pdfaw-loading pdfaw-error", text: `Could not open PDF. ${error instanceof Error ? error.message : String(error)}` });
      this.saveStatus.setText("Failed to load");
      new Notice("Remark My Words: Failed to load. Existing annotation files have not been changed.");
      console.error("Remark My Words", error);
    }
  }

  async onUnloadFile() { await this.flushNotes(); this.releaseDocument(); this.sidecar = null; }
  async onClose() {
    await this.flushNotes(); this.releaseDocument(); this.commentPreview.destroy(); this.resizeObserver?.disconnect(); this.win.cancelAnimationFrame(this.geometryFrame);
    if (this.workerUrl) URL.revokeObjectURL(this.workerUrl);
    this.workerUrl = null;
  }
  private releaseDocument() {
    this.commentPreview.hide();
    this.selectionPointer = null; this.commentPress = null; this.pageChangePending = false;
    this.generation++; this.pageGeneration++; this.searchGeneration++;
    this.thumbObserver?.disconnect();
    for (const task of this.renderTasks) task.cancel();
    this.renderTasks.clear(); this.pageTask = null;
    this.textLayer?.cancel(); this.textLayer = null;
    if (this.loading) void this.loading.destroy().catch(() => {});
    this.loading = null; this.pdf = null; this.pageReady = false;
    this.clearSelection(); this.cards.forEach(card => this.resizeObserver?.unobserve(card));
    this.cards.clear(); this.thumbButtons.clear(); this.searchText.clear();
    this.searchPages = []; this.searchIndex = -1; this.searchInput.value = ""; this.searchStatus.setText("");
    this.gesture = null; this.activeId = null;
  }
  private async flushNotes() {
    if (this.notesTimer !== undefined) { this.win.clearTimeout(this.notesTimer); this.notesTimer = undefined; await this.save(); }
    await this.saveQueue;
  }
  private save(): Promise<void> {
    if (!this.sidecar) return Promise.resolve();
    const path = `${this.sidecar.pdfPath}.obsidian-annot.json`, data = JSON.stringify(this.sidecar, null, 2);
    const generation = this.generation, revision = ++this.saveRevision;
    this.saveStatus.setText("Saving …");
    this.saveQueue = this.saveQueue.then(async () => {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) await this.app.vault.modify(file, data); else await this.app.vault.create(path, data);
      if (generation === this.generation && revision === this.saveRevision) this.saveStatus.setText("Saved to vault");
    }).catch(error => {
      if (generation === this.generation) this.saveStatus.setText("Failed to save");
      new Notice("Could not save comments. Check write permissions for the vault.");
      console.error("Remark My Words: save", error);
    });
    return this.saveQueue;
  }

  private async renderCanvas(page: pdfjs.PDFPageProxy, canvas: HTMLCanvasElement, scale: number, density: number, main = false) {
    const viewport = page.getViewport({ scale });
    canvas.width = Math.ceil(viewport.width * density); canvas.height = Math.ceil(viewport.height * density);
    canvas.setCssProps({ "--canvas-width": `${viewport.width}px`, "--canvas-height": `${viewport.height}px` });
    const context = canvas.getContext("2d"); if (!context) throw new Error("Canvas unavailable.");
    const task = page.render({ canvasContext: context, viewport, transform: density === 1 ? undefined : [density, 0, 0, density, 0, 0] });
    if (main) this.pageTask = task;
    this.renderTasks.add(task);
    try { await task.promise; } finally { this.renderTasks.delete(task); if (this.pageTask === task) this.pageTask = null; }
  }
  private async showPage(pageNumber: number) {
    if (!this.pdf || !Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > this.pdf.numPages) return;
    this.currentPage = pageNumber; this.pageReady = false; this.viewport.scrollTop = 0; this.viewport.scrollLeft = 0;
    const token = ++this.pageGeneration, generation = this.generation;
    this.pageTask?.cancel(); this.textLayer?.cancel(); this.clearSelection();
    this.pageInput.value = String(pageNumber);
    this.thumbButtons.forEach((button, page) => { button.toggleClass("is-active", page === pageNumber); button.setAttribute("aria-current", page === pageNumber ? "page" : "false"); });
    this.thumbButtons.get(pageNumber)?.scrollIntoView({ block: "nearest" });
    this.pageEl.empty(); this.cardsEl.empty(); this.links.replaceChildren(); this.commentPreview.hide();
    this.pageEl.createDiv({ cls: "pdfaw-loading", text: "Loading page …" });
    try {
      const page = await this.pdf.getPage(pageNumber);
      if (token !== this.pageGeneration || generation !== this.generation) return;
      const viewport = page.getViewport({ scale: PDF_SCALE });
      this.pageWidth = viewport.width; this.pageHeight = viewport.height;
      this.pageEl.empty(); this.pageEl.style.width = `${this.pageWidth}px`; this.pageEl.style.height = `${this.pageHeight}px`;
      this.pageEl.style.setProperty("--scale-factor", String(PDF_SCALE)); this.pageEl.dataset.page = String(pageNumber);
      const canvas = this.pageEl.createEl("canvas", { attr: { "aria-label": `PDF page ${pageNumber}` } });
      this.renderAnnotations(); this.fit();
      await this.renderCanvas(page, canvas, PDF_SCALE, Math.min(this.win.devicePixelRatio || 1, 2), true);
      if (token !== this.pageGeneration || generation !== this.generation) return;
      const layer = this.pageEl.createDiv({ cls: "pdfaw-textlayer" });
      const content = await page.getTextContent();
      if (token !== this.pageGeneration || generation !== this.generation) return;
      this.searchText.set(pageNumber, content.items.map(item => "str" in item ? item.str : "").join(" ").toLocaleLowerCase());
      this.textLayer = new pdfjs.TextLayer({ textContentSource: content, container: layer, viewport });
      await this.textLayer.render();
      if (token !== this.pageGeneration || generation !== this.generation) return;
      this.pageReady = true; this.highlightSearch(); this.renderAnnotations();
    } catch (error) {
      if (token !== this.pageGeneration || generation !== this.generation) return;
      this.pageEl.createDiv({ cls: "pdfaw-loading pdfaw-error", text: "Could not render this page." });
      console.error("Remark My Words: page", error);
    }
  }
  private buildThumbnails() {
    this.thumbnails.empty(); const generation = this.generation;
    this.thumbObserver = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        this.thumbObserver?.unobserve(entry.target);
        const button = entry.target as HTMLButtonElement;
        void this.renderThumbnail(Number(button.dataset.page), button, generation);
      }
    }, { root: this.thumbnails, rootMargin: "200px" });
    for (let page = 1; page <= this.pdf!.numPages; page++) {
      const button = this.thumbnails.createEl("button", { cls: "pdfaw-thumbnail", attr: { "aria-label": `Page ${page}`, "data-page": String(page) } });
      button.createDiv({ cls: "pdfaw-thumbnail-paper" }); button.createSpan({ text: String(page) });
      button.onclick = () => void this.showPage(page);
      this.thumbButtons.set(page, button); this.thumbObserver.observe(button);
    }
  }
  private async renderThumbnail(number: number, button: HTMLButtonElement, generation: number) {
    try {
      const page = await this.pdf?.getPage(number); if (!page || generation !== this.generation) return;
      const paper = button.querySelector<HTMLElement>(".pdfaw-thumbnail-paper")!;
      const canvas = paper.createEl("canvas"), viewport = page.getViewport({ scale: 1 });
      await this.renderCanvas(page, canvas, Math.min(104 / viewport.width, 146 / viewport.height), 1.5);
    } catch (error) { if (generation === this.generation) console.warn("Remark My Words: thumbnail", error); }
  }

  private pageAnnotations() { return (this.sidecar?.annotations ?? []).filter(annotation => annotation.page === this.currentPage); }
  private visibleAnnotations() { return this.pageAnnotations().filter(annotation => this.mode === "reading" || !this.filter || annotation.category === this.filter); }
  private position(annotation: Annotation): Point { return annotation.position ?? defaultPosition(this.pageAnnotations().indexOf(annotation), this.pageWidth); }

  private renderCategoryTools() {
    this.selectionBar.empty();
    this.selectionBar.toggleClass("is-vertical", this.selectionBarOrientation === "vertical");
    const handle = this.button(this.selectionBar, "grip", "Move category toolbar", () => {}, "pdfaw-selection-handle");
    handle.onpointerdown = event => this.startSelectionBarDrag(event);
    this.button(this.selectionBar, this.selectionBarOrientation === "horizontal" ? "rows-2" : "columns-2", this.selectionBarOrientation === "horizontal" ? "Switch to vertical category toolbar" : "Switch to horizontal category toolbar", () => {
      this.selectionBarOrientation = this.selectionBarOrientation === "horizontal" ? "vertical" : "horizontal";
      this.renderCategoryTools(); this.positionSelectionBar();
    });
    for (const category of this.categories.active()) {
      const button = this.button(this.selectionBar, category.icon, category.label, () => this.editSelection(category.id));
      button.setCssProps({ "--category": category.hex }); button.onpointerdown = event => event.preventDefault();
    }
  }
  private renderFilters() {
    this.filterBar.empty();
    const all = this.filterBar.createEl("button", { text: "All", cls: this.filter === null ? "is-active" : "" });
    all.setAttribute("aria-pressed", String(this.filter === null));
    all.onclick = () => { this.filter = null; this.renderFilters(); this.renderAnnotations(); };
    const choices = this.categories.active();
    for (const annotation of this.pageAnnotations()) {
      if (!choices.some(item => item.id === annotation.category)) choices.push({ id: annotation.category, ...this.categories.forAnnotation(annotation) });
    }
    for (const category of choices) {
      const button = this.filterBar.createEl("button", { cls: this.filter === category.id ? "is-active" : "", attr: { "aria-pressed": String(this.filter === category.id) } });
      button.style.setProperty("--category", category.hex);
      button.createSpan({ cls: "pdfaw-category-dot" }); button.createSpan({ text: category.label });
      button.onclick = () => { this.filter = this.filter === category.id ? null : category.id; this.renderFilters(); this.renderAnnotations(); };
    }
  }
  private renderAnnotations() {
    this.commentPreview.hide();
    this.sidecar?.annotations.forEach(annotation => { annotation.categoryStyle = this.categories.forAnnotation(annotation); });
    this.pageAnnotations().forEach((annotation, index) => { annotation.position ??= defaultPosition(index, this.pageWidth); });
    this.pageEl.querySelector(".pdfaw-highlights")?.remove();
    const overlay = this.pageEl.createDiv({ cls: "pdfaw-highlights" });
    this.cards.forEach(card => this.resizeObserver?.unobserve(card)); this.cards.clear(); this.cardsEl.empty();
    for (const annotation of this.visibleAnnotations()) {
      const category = this.categories.forAnnotation(annotation);
      for (const quad of annotation.quads) {
        const highlight = overlay.createDiv({ cls: `pdfaw-highlight${this.activeId === annotation.id ? " is-active" : ""}` });
        Object.assign(highlight.style, { left: `${quad.x}px`, top: `${quad.y}px`, width: `${quad.w}px`, height: `${quad.h}px`, backgroundColor: category.hex });
      }
      const card = this.cardsEl.createDiv({ cls: "pdfaw-comment-card", attr: { tabindex: "0", "aria-label": `${category.label}: ${annotation.title || annotation.text}`, "data-id": annotation.id } });
      card.style.setProperty("--category", category.hex);
      const position = this.position(annotation);
      card.style.left = `${position.x}px`; card.style.top = `${position.y}px`; card.toggleClass("is-active", this.activeId === annotation.id);
      const header = card.createDiv({ cls: "pdfaw-card-header" });
      const badge = header.createDiv({ cls: "pdfaw-badge" });
      setIcon(badge.createSpan(), category.icon); badge.createSpan({ text: category.label });
      this.button(header, "ellipsis", "Comment actions", () => this.cardMenu(annotation, header));
      header.onpointerdown = event => {
        if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
        event.preventDefault(); event.stopPropagation(); card.focus(); this.activeId = annotation.id;
        this.gesture = { pointer: event.pointerId, start: { x: event.clientX, y: event.clientY }, origin: { ...this.position(annotation) }, card: annotation, element: header };
        header.setPointerCapture(event.pointerId); card.addClass("is-dragging");
      };
      card.createEl("h3", { text: annotation.title || (annotation.comment ? "Comment" : "Highlighted passage") });
      const body = card.createDiv({ cls: "pdfaw-comment-body" });
      if (annotation.comment) body.createDiv({ text: annotation.comment }); else body.createEl("blockquote", { text: annotation.text });
      if (annotation.tags?.length) {
        const tags = card.createDiv({ cls: "pdfaw-tags" }); annotation.tags.forEach(tag => tags.createSpan({ text: tag }));
      }
      const footer = card.createDiv({ cls: "pdfaw-card-footer" });
      const jump = footer.createEl("button", { text: `↗ p. ${annotation.page}`, attr: { "aria-label": "Go to highlighted passage" } });
      jump.onclick = () => this.focusAnnotation(annotation);
      footer.createEl("time", { text: new Date(annotation.updatedAt).toLocaleDateString("en-US", { day: "2-digit", month: "short" }), attr: { datetime: new Date(annotation.updatedAt).toISOString() } });
      card.ondblclick = event => { if (!(event.target as HTMLElement).closest("button")) this.editAnnotation(annotation); };
      card.onkeydown = event => {
        if (event.target !== card) return;
        if (event.key === "Enter") { event.preventDefault(); this.editAnnotation(annotation); }
        const delta: Record<string, Point> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
        if (delta[event.key]) {
          event.preventDefault(); event.stopPropagation();
          const old = this.position(annotation), step = event.shiftKey ? 40 : 10;
          annotation.position = { x: old.x + delta[event.key].x * step, y: old.y + delta[event.key].y * step };
          card.style.left = `${annotation.position.x}px`; card.style.top = `${annotation.position.y}px`;
          this.queueGeometry(); void this.save();
        }
      };
      this.cards.set(annotation.id, card); this.resizeObserver?.observe(card);
    }
    this.status.setText(`${this.file?.name ?? "PDF"}  /  Page ${this.currentPage}  ·  ${this.visibleAnnotations().length} of ${this.sidecar?.annotations.length ?? 0} annotations`);
    this.queueGeometry();
  }
  private rearrangeCards() {
    let leftY = 28, rightY = 28;
    this.pageAnnotations().forEach((annotation, index) => {
      const card = this.cards.get(annotation.id), height = card?.offsetHeight || 220;
      const left = index % 2 === 0;
      annotation.position = { x: left ? -CARD_WIDTH - 90 : this.pageWidth + 90, y: left ? leftY : rightY };
      if (left) leftY += height + 24; else rightY += height + 24;
    });
    this.renderAnnotations(); this.fit(); void this.save();
  }
  private cardMenu(annotation: Annotation, element: HTMLElement) {
    const menu = new Menu();
    menu.addItem(item => item.setTitle("Edit").setIcon("pencil").onClick(() => this.editAnnotation(annotation)));
    menu.addItem(item => item.setTitle("Go to passage").setIcon("locate").onClick(() => this.focusAnnotation(annotation)));
    menu.addSeparator();
    for (const category of this.categories.active()) menu.addItem(item => item.setTitle(category.label).setIcon(category.icon).setChecked(annotation.category === category.id).onClick(() => {
      annotation.category = category.id; annotation.categoryStyle = this.categories.style(category.id); annotation.color = category.color; annotation.updatedAt = Date.now(); this.renderAnnotations(); void this.save();
    }));
    menu.addSeparator();
    menu.addItem(item => item.setTitle("Delete comment").setIcon("trash-2").onClick(() => this.deleteAnnotation(annotation)));
    menu.showAtPosition(this.menuPosition(element));
  }
  private deleteAnnotation(annotation: Annotation) {
    if (!this.sidecar?.annotations.some(item => item.id === annotation.id)) return;
    this.sidecar.annotations = this.sidecar.annotations.filter(item => item.id !== annotation.id);
    if (this.activeId === annotation.id) this.activeId = null;
    this.commentPreview.hide(); this.renderAnnotations(); void this.save();
  }
  private editAnnotation(annotation: Annotation) {
    const data = this.sidecar;
    new CommentModal(this.app, annotation, annotation.text, draft => {
      if (this.sidecar !== data) return;
      Object.assign(annotation, draft, { color: this.categories.style(draft.category, annotation.categoryStyle).color, categoryStyle: this.categories.style(draft.category, annotation.categoryStyle), updatedAt: Date.now() }); this.commentPreview.hide(); this.renderAnnotations(); void this.save();
    }, this.categories.choices(annotation)).open();
  }
  private editSelection(category: Category) {
    if (!this.selection || !this.sidecar) { new Notice("Select a passage in the PDF first."); return; }
    const selection = this.selection, data = this.sidecar;
    this.clearSelection(); this.win.getSelection()?.removeAllRanges();
    new CommentModal(this.app, { category, title: "", comment: "", tags: [] }, selection.text, (draft: CommentDraft) => {
      if (this.sidecar !== data) return;
      const now = Date.now();
      data.annotations.push({ id: crypto.randomUUID(), ...selection, ...draft, color: this.categories.style(draft.category).color, categoryStyle: this.categories.style(draft.category), createdAt: now, updatedAt: now });
      if (this.filter && this.filter !== draft.category) { this.filter = null; this.renderFilters(); }
      this.clearSelection(); this.win.getSelection()?.removeAllRanges(); this.renderAnnotations(); if (this.mode === "canvas") this.fit(); void this.save();
    }, this.categories.active()).open();
  }
  private openCommentAt(event: MouseEvent) {
    const press = this.commentPress; this.commentPress = null;
    if (this.mode !== "reading" || !this.pageReady || event.button !== 0 || event.detail !== 1 || !press || press.dragged) return;
    this.captureSelection();
    if (this.selectionPointer !== null || this.selection) return;
    const box = this.pageEl.getBoundingClientRect(), zoom = this.camera.zoom;
    const x = (event.clientX - box.left) / zoom, y = (event.clientY - box.top) / zoom;
    const matches = this.pageAnnotations().filter(annotation => annotation.quads.some(q => x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h));
    if (!matches.length) return;
    const quad = matches[0].quads.find(q => x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h)!;
    this.commentPreview.show(matches, { left: box.left + quad.x * zoom, top: box.top + quad.y * zoom, bottom: box.top + (quad.y + quad.h) * zoom }, this.root);
  }
  private captureSelection() {
    if (this.tool !== "select" || !this.pageReady) return;
    const selection = this.win.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed || !selection.toString().trim()) { this.clearSelection(); return; }
    const range = selection.getRangeAt(0);
    const layer = this.pageEl.querySelector<HTMLElement>(".pdfaw-textlayer");
    if (!layer || !layer.contains(range.startContainer) || !layer.contains(range.endContainer)) { this.clearSelection(); return; }
    this.commentPreview.hide();
    const box = this.pageEl.getBoundingClientRect(), zoom = this.camera.zoom;
    const quads = selectionQuads(range, layer, box, zoom);
    this.clearSelection();
    if (!quads.length) return;
    const overlay = this.pageEl.createDiv({ cls: "pdfaw-selection", attr: { "aria-hidden": "true" } });
    for (const q of quads) {
      const rect = overlay.createDiv();
      Object.assign(rect.style, { left: `${q.x}px`, top: `${q.y}px`, width: `${q.w}px`, height: `${q.h}px` });
    }
    this.selection = { page: this.currentPage, text: selection.toString().trim(), quads }; this.positionSelectionBar();
  }
  private clearSelection() {
    this.selection = null; this.selectionBarPosition = null; this.selectionDrag = null;
    if (this.selectionBar) this.selectionBar.hidden = true;
    this.pageEl?.querySelector(".pdfaw-selection")?.remove();
  }
  private positionSelectionBar() {
    if (!this.selection) return;
    if (this.selectionPointer !== null) { this.selectionBar.hidden = true; return; }
    const q = this.selection.quads[this.selection.quads.length - 1];
    const page = this.pageEl.getBoundingClientRect(), viewport = this.viewport.getBoundingClientRect(), root = this.root.getBoundingClientRect();
    const bottom = page.top + (q.y + q.h) * this.camera.zoom, top = page.top + q.y * this.camera.zoom;
    this.selectionBar.hidden = bottom < viewport.top || top > viewport.bottom;
    if (this.selectionBar.hidden) return;
    this.selectionBar.style.maxWidth = `${Math.max(0, this.root.clientWidth - 16)}px`;
    const width = this.selectionBar.offsetWidth, height = this.selectionBar.offsetHeight;
    if (this.selectionBarPosition) {
      const maxX = Math.max(8, this.root.clientWidth - width - 8), maxY = Math.max(8, this.root.clientHeight - height - 8);
      this.selectionBar.style.left = `${Math.max(8, Math.min(maxX, this.selectionBarPosition.x))}px`;
      this.selectionBar.style.top = `${Math.max(8, Math.min(maxY, this.selectionBarPosition.y))}px`;
      return;
    }
    const left = Math.max(viewport.left + 8, Math.min(viewport.right - width - 8, page.left + q.x * this.camera.zoom));
    const y = bottom + height + 10 < viewport.bottom ? bottom + 10 : top - height - 10;
    this.selectionBarPosition = { x: left - root.left, y: Math.max(viewport.top + 8, Math.min(viewport.bottom - height - 8, y)) - root.top };
    this.selectionBar.style.left = `${this.selectionBarPosition.x}px`;
    this.selectionBar.style.top = `${this.selectionBarPosition.y}px`;
  }
  private startSelectionBarDrag(event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    this.selectionBarPosition ??= { x: this.selectionBar.offsetLeft, y: this.selectionBar.offsetTop };
    this.selectionDrag = { pointer: event.pointerId, start: { x: event.clientX, y: event.clientY }, origin: { ...this.selectionBarPosition } };
    this.selectionBar.setPointerCapture(event.pointerId);
  }
  private moveSelectionBarDrag(event: PointerEvent) {
    const drag = this.selectionDrag; if (!drag || drag.pointer !== event.pointerId) return;
    this.selectionBarPosition = { x: drag.origin.x + event.clientX - drag.start.x, y: drag.origin.y + event.clientY - drag.start.y };
    this.positionSelectionBar();
  }
  private endSelectionBarDrag(event: PointerEvent) {
    if (this.selectionDrag?.pointer !== event.pointerId) return;
    if (this.selectionBar.hasPointerCapture(event.pointerId)) this.selectionBar.releasePointerCapture(event.pointerId);
    this.selectionDrag = null;
  }
  private focusAnnotation(annotation: Annotation) {
    const q = annotation.quads[0]; this.activeId = annotation.id;
    this.camera.x = this.viewport.clientWidth / 2 - (q.x + q.w / 2) * this.camera.zoom;
    this.camera.y = this.viewport.clientHeight / 2 - q.y * this.camera.zoom; this.renderAnnotations(); this.applyCamera();
  }
  private setTool(tool: "select" | "hand") {
    if (this.mode === "reading") tool = "select";
    this.tool = tool; this.root.toggleClass("pdfaw-hand", tool === "hand");
    this.toolButtons.forEach((button, key) => { button.toggleClass("is-active", key === tool); button.setAttribute("aria-pressed", String(key === tool)); });
    if (tool === "hand") { this.clearSelection(); this.win.getSelection()?.removeAllRanges(); }
  }
  private startPan(event: PointerEvent) {
    this.commentPreview.hide();
    if (this.mode === "reading") { if (!(event.target as HTMLElement).closest(".pdfaw-selection-toolbar")) this.clearSelection(); return; }
    const target = event.target as HTMLElement;
    if (target.closest("button, input, textarea, .pdfaw-comment-card, .pdfaw-filters, .pdfaw-selection-toolbar")) return;
    if (event.button !== 1 && (event.button !== 0 || (this.tool !== "hand" && target.closest(".pdfaw-page")))) {
      if (event.button === 0) this.clearSelection(); return;
    }
    event.preventDefault(); this.clearSelection(); this.root.focus();
    this.gesture = { pointer: event.pointerId, start: { x: event.clientX, y: event.clientY }, origin: { x: this.camera.x, y: this.camera.y }, element: this.viewport };
    this.viewport.setPointerCapture(event.pointerId); this.viewport.addClass("is-panning");
  }
  private moveGesture(event: PointerEvent) {
    const gesture = this.gesture; if (!gesture || gesture.pointer !== event.pointerId) return;
    const dx = event.clientX - gesture.start.x, dy = event.clientY - gesture.start.y;
    if (gesture.card) {
      gesture.card.position = { x: gesture.origin.x + dx / this.camera.zoom, y: gesture.origin.y + dy / this.camera.zoom };
      const card = this.cards.get(gesture.card.id)!;
      card.style.left = `${gesture.card.position.x}px`; card.style.top = `${gesture.card.position.y}px`; this.queueGeometry();
    } else { this.camera.x = gesture.origin.x + dx; this.camera.y = gesture.origin.y + dy; this.applyCamera(); }
  }
  private endGesture(event: PointerEvent) {
    const gesture = this.gesture; if (!gesture || gesture.pointer !== event.pointerId) return;
    if (gesture.element.hasPointerCapture(event.pointerId)) gesture.element.releasePointerCapture(event.pointerId);
    if (gesture.card) { this.cards.get(gesture.card.id)?.removeClass("is-dragging"); void this.save(); }
    this.viewport.removeClass("is-panning"); this.gesture = null;
  }
  private cardBounds(): Bounds[] { return this.visibleAnnotations().map(annotation => ({ ...this.position(annotation), width: CARD_WIDTH, height: this.cards.get(annotation.id)?.offsetHeight || 220 })); }
  private bounds() { return sceneBounds(this.pageWidth, this.pageHeight, this.cardBounds()); }
  private setMode(mode: "canvas" | "reading") {
    if (mode === this.mode) return;
    this.commentPress = null;
    this.clearSelection(); this.win.getSelection()?.removeAllRanges();
    if (mode === "reading") this.canvasCamera = { ...this.camera };
    this.mode = mode; this.root.toggleClass("pdfaw-reading", mode === "reading");
    this.modeButtons.forEach((button, key) => button.setAttribute("aria-pressed", String(key === mode)));
    this.toolButtons.get("hand")!.hidden = mode === "reading";
    this.setTool("select");
    this.renderAnnotations();
    this.viewport.scrollTo(0, 0);
    if (mode === "reading") this.fit();
    else {
      if (this.canvasCamera) { this.camera = this.canvasCamera; this.applyCamera(); } else this.fit();
    }
  }
  private fit() {
    if (!this.pdf) return;
    if (this.mode === "reading") {
      this.camera.zoom = Math.max(0.1, Math.min(1.3, (this.viewport.clientWidth - 48) / this.pageWidth));
      this.applyCamera(); this.viewport.scrollTo(0, 0); return;
    }
    this.camera = fitCamera(this.bounds(), this.viewport.clientWidth, Math.max(100, this.viewport.clientHeight - 65));
    this.camera.y += 45; this.applyCamera();
  }
  private zoomBy(factor: number, client?: Point) {
    const rect = this.viewport.getBoundingClientRect();
    const x = client ? client.x - rect.left : rect.width / 2, y = client ? client.y - rect.top : rect.height / 2;
    const zoom = Math.max(0.1, Math.min(3, this.camera.zoom * factor)), ratio = zoom / this.camera.zoom;
    if (this.mode === "reading") {
      const left = (this.viewport.scrollLeft + x) * ratio - x, top = (this.viewport.scrollTop + y) * ratio - y;
      this.camera.zoom = zoom; this.applyCamera(); this.viewport.scrollTo(left, top); return;
    }
    this.camera = { x: x - (x - this.camera.x) * ratio, y: y - (y - this.camera.y) * ratio, zoom }; this.applyCamera();
  }
  private applyCamera() {
    this.commentPreview.hide();
    const { x, y, zoom } = this.camera;
    if (this.mode === "reading") {
      this.stage.setCssProps({ "--reading-width": `${this.pageWidth * zoom}px`, "--reading-height": `${this.pageHeight * zoom}px` });
      this.pageEl.setCssProps({ "--reading-transform": `scale(${zoom})` });
      this.zoomLabel.setText(`${Math.round(zoom * 100)} %`); this.positionSelectionBar(); return;
    }
    this.stage.setCssProps({ "--canvas-transform": `translate(${x}px, ${y}px) scale(${zoom})` });
    this.viewport.style.backgroundPosition = `${x}px ${y}px`; this.viewport.style.backgroundSize = `${22 * zoom}px ${22 * zoom}px`;
    this.zoomLabel.setText(`${Math.round(zoom * 100)} %`); this.positionSelectionBar(); this.queueGeometry();
  }
  private queueGeometry() {
    if (this.geometryFrame) return;
    this.geometryFrame = this.win.requestAnimationFrame(() => { this.geometryFrame = 0; if (this.mode === "canvas") this.drawConnections(); });
  }
  private drawConnections() {
    this.links.replaceChildren();
    for (const annotation of this.visibleAnnotations()) {
      const card = this.cards.get(annotation.id); if (!card) continue;
      const color = this.categories.forAnnotation(annotation).hex;
      const { path, anchor } = connection({ ...this.position(annotation), width: CARD_WIDTH, height: card.offsetHeight }, annotation.quads[0]);
      svg(this.links, "path", { d: path, stroke: color, "stroke-width": 2, "stroke-dasharray": "8 7", "stroke-linecap": "round", fill: "none", "vector-effect": "non-scaling-stroke" });
      svg(this.links, "circle", { cx: anchor.x, cy: anchor.y, r: 3, fill: color });
    }
  }
  private clearSearch() { this.searchGeneration++; this.searchPages = []; this.searchIndex = -1; this.searchStatus.setText(""); this.pageEl.querySelectorAll(".pdfaw-search-hit").forEach(el => el.removeClass("pdfaw-search-hit")); }
  private async searchDocument(direction: number) {
    const query = this.searchInput.value.trim().toLocaleLowerCase(); if (!query || !this.pdf) return;
    if (this.searchIndex >= 0 && this.searchPages.length) this.searchIndex = (this.searchIndex + direction + this.searchPages.length) % this.searchPages.length;
    else {
      const token = ++this.searchGeneration, pdf = this.pdf; this.searchStatus.setText("Searching …"); const pages: number[] = [];
      try {
        for (let number = 1; number <= pdf.numPages; number++) {
          if (token !== this.searchGeneration) return;
          let text = this.searchText.get(number);
          if (text === undefined) {
            const content = await (await pdf.getPage(number)).getTextContent(); if (token !== this.searchGeneration) return;
            text = content.items.map(item => "str" in item ? item.str : "").join(" ").toLocaleLowerCase(); this.searchText.set(number, text);
          }
          if (text.includes(query)) pages.push(number);
        }
        if (token !== this.searchGeneration) return;
        this.searchPages = pages; this.searchIndex = pages.length ? 0 : -1;
      } catch { if (token === this.searchGeneration) this.searchStatus.setText("Search failed"); return; }
    }
    this.searchStatus.setText(this.searchPages.length ? `${this.searchIndex + 1}/${this.searchPages.length} Pages` : "No matches");
    if (this.searchIndex >= 0) await this.showPage(this.searchPages[this.searchIndex]);
  }
  private highlightSearch() {
    const query = this.searchInput.value.trim().toLocaleLowerCase(); if (!query) return;
    this.pageEl.querySelectorAll<HTMLElement>(".pdfaw-textlayer span").forEach(span => span.toggleClass("pdfaw-search-hit", !!span.textContent?.toLocaleLowerCase().includes(query)));
  }
  private onKey(event: KeyboardEvent) {
    if (event.key === "Escape") this.commentPreview.hide();
    if ((event.target as HTMLElement).closest("input, textarea, [contenteditable=true]")) return;
    if ((event.ctrlKey || event.metaKey) && event.key === "f") { event.preventDefault(); this.searchInput.focus(); return; }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Escape") { this.clearSelection(); this.win.getSelection()?.removeAllRanges(); this.setTool("select"); }
    if (event.key.toLowerCase() === "h") this.setTool("hand");
    if (event.key.toLowerCase() === "v") this.setTool("select");
    if (event.key === "0") this.fit();
    if (event.key === "+" || event.key === "=") this.zoomBy(1.15);
    if (event.key === "-") this.zoomBy(1 / 1.15);
    if (event.key === "PageDown") { event.preventDefault(); void this.showPage(this.currentPage + 1); }
    if (event.key === "PageUp") { event.preventDefault(); void this.showPage(this.currentPage - 1); }
  }
}

export default class RemarkMyWordsPlugin extends Plugin {
  private categories!: CategoryStore;
  async onload() {
    const stored: unknown = await this.loadData();
    this.categories = new CategoryStore(readCategorySettings(stored), categories => this.saveData({ categories }));
    this.registerView(VIEW_TYPE, leaf => new PdfAnnotatorView(leaf, this.categories));
    this.addCommand({ id: "open-pdf-in-annotator", name: "Open PDF", callback: () => this.openPdf() });
    this.addCommand({ id: "manage-categories", name: "Customize", callback: () => new CategoryModal(this.app, this.categories).open() });
    this.addRibbonIcon("file-pen-line", "Remark My Words", () => this.openPdf());
    this.addSettingTab(new RemarkSettingsTab(this.app, this, this.categories, () => this.openPdf()));
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
      if (file instanceof TFile && file.extension.toLowerCase() === "pdf") menu.addItem(item => item.setTitle("Open in Remark My Words").setIcon("file-pen-line").onClick(() => {
        void this.app.workspace.getLeaf(false).setViewState({ type: VIEW_TYPE, state: { file: file.path }, active: true });
      }));
    }));
  }
  private openPdf() {
    const open = (file: TFile) => { void this.app.workspace.getLeaf(false).setViewState({ type: VIEW_TYPE, state: { file: file.path }, active: true }); };
    const active = this.app.workspace.getActiveFile();
    if (active?.extension.toLowerCase() === "pdf") open(active);
    else new PdfPicker(this.app, open).open();
  }
}
