import { FileView, Menu, Notice, Plugin, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy, PDFDocumentLoadingTask, RenderTask } from "pdfjs-dist";
import { Annotation, Bounds, CARD_WIDTH, Category, Point, Quad, Sidecar, connection, defaultPosition, fitCamera, readSidecar } from "./model";
import { CommentDraft, CommentModal } from "./editor";
import { selectionQuads } from "./selection";
import { CommentPreview } from "./comment-preview";
import { CategoryStore, readCategorySettings, readThemeColors } from "./category-store";
import { CategoryModal } from "./category-modal";
import { PdfPicker, RemarkSettingsTab } from "./plugin-access";
import workerSource from "embedded-pdf-worker";
import { applyThemeColors } from "./theme";
import { DeleteCommentModal, GroupNameModal } from "./modal";
import { COMMENTS_VIEW, PAGES_VIEW, PdfSidebar, Sidebars } from "./sidebar";
import { PdfPages, PageSurface } from "./pdf-pages";
import { BoardLayout, LayoutHistory, emptyLayout, estimatedHeight, ensureLayout, arrangeLayout, pageKey, cardKey, enclosingBounds, intersects, snappedDelta } from "./board-model";

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
  private mode: "canvas" | "reading" = "reading";
  private canvasCamera: typeof this.camera | null = null;
  private modeButtons = new Map<string, HTMLButtonElement>();
  private selectionBar!: HTMLDivElement;
  private commentPreview!: CommentPreview;
  private filterBar!: HTMLDivElement;
  private toolButtons = new Map<string, HTMLButtonElement>();
  private cards = new Map<string, HTMLDivElement>();
  private cardSizes = new Map<string, number>();
  private cardSignatures = new Map<string, string>();
  private connections = new Map<string, { path: SVGPathElement; anchor: SVGCircleElement; signature: string }>();
  private rasterFrame = 0;
  private dimensionFrame = 0;
  private autoPages = new Set<string>();
  private autoCards = new Set<string>();
  private layoutSaved = false;
  private thumbQueue: number[] = [];
  private thumbRunning = false;
  private thumbButtons = new Map<number, HTMLButtonElement>();
  private sidecar: Sidecar | null = null;
  private pdf: PDFDocumentProxy | null = null;
  private loading: PDFDocumentLoadingTask | null = null;
  private workerUrl: string | null = null;
  private renderTasks = new Set<RenderTask>();
  private pages!: PdfPages;
  private get pageTask() { return this.pages?.surfaces.get(this.currentPage)?.task ?? null; }
  private get pageCanvas() { return this.pages?.surfaces.get(this.currentPage)?.canvas ?? null; }
  private get rasterDensity() { return this.pages?.surfaces.get(this.currentPage)?.density ?? 0; }
  private get requestedDensity() { return this.pages?.surfaces.get(this.currentPage)?.requested ?? 0; }
  private get rasterTimer() { return this.pages?.timer; }
  private thumbObserver: IntersectionObserver | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private saveQueue: Promise<void> = Promise.resolve();
  private saveRevision = 0;
  private notesTimer: number | undefined;
  private generation = 0;
  private pageGeneration = 0;
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
  private gesture: { pointer: number; start: Point; origin: Point; element: HTMLElement; nodes?: Map<string, Point>; before?: BoardLayout; marquee?: Point; additive?: Set<string> } | null = null;
  private selectedNodes = new Set<string>();
  private multiSelect = false;
  private multiSelectButton!: HTMLButtonElement;
  private history = new LayoutHistory();
  private groupsEl!: HTMLDivElement;
  private groupElements = new Map<string, HTMLDivElement>();
  private marqueeEl!: HTMLDivElement;
  private snapButton!: HTMLButtonElement;
  private undoButton!: HTMLButtonElement;
  private redoButton!: HTMLButtonElement;
  private pinch: { ids: number[]; distance: number; zoom: number; anchor: Point } | null = null;
  private pinchActive = false;
  private pageReady = false;
  private geometryFrame = 0;
  private fileReady: Promise<void> = Promise.resolve();

  constructor(leaf: WorkspaceLeaf, private categories: CategoryStore, private sidebars: Sidebars) { super(leaf); }
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
    this.root = this.contentEl.createDiv({ cls: "pdfaw-root pdfaw-reading", attr: { tabindex: "0" } });
    this.applyTheme();
    const toolbar = this.root.createDiv({ cls: "pdfaw-toolbar" });

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
    navigation.createSpan({ text: "/", attr: { "aria-hidden": "true" } });
    this.pageTotal = navigation.createSpan({ cls: "pdfaw-page-total", text: "0" });
    this.button(navigation, "chevron-right", "Next page", () => void this.showPage(this.currentPage + 1));
    const right = toolbar.createDiv({ cls: "pdfaw-tool-group pdfaw-toolbar-end" });
    this.button(right, "messages-square", "Read page comments", () => {
      this.updateSidebar(); void this.sidebars.show(COMMENTS_VIEW);
    }, "pdfaw-read-comments");
    this.button(right, "layout-dashboard", "Rearrange pages and comments", () => { void this.rearrangeCards(); }, "pdfaw-canvas-control");
    this.undoButton = this.button(right, "undo-2", "Undo canvas change", () => this.restoreLayout(false), "pdfaw-canvas-control");
    this.redoButton = this.button(right, "redo-2", "Redo canvas change", () => this.restoreLayout(true), "pdfaw-canvas-control");
    this.snapButton = this.button(right, "magnet", "Snap to grid and objects", () => this.toggleSnap(), "pdfaw-canvas-control");
    this.multiSelectButton = this.button(right, "list-checks", "Select multiple items", () => { this.multiSelect = !this.multiSelect; this.updateSelectionPaint(); }, "pdfaw-canvas-control");
    const canvasActions = this.button(right, "ellipsis", "Canvas actions", () => { if (!this.sidecar) return; const menu = new Menu(); this.addLayoutMenu(menu); menu.showAtPosition(this.menuPosition(canvasActions)); }, "pdfaw-canvas-control");
    this.button(right, "group", "Group selection", () => this.groupSelection(), "pdfaw-canvas-control");
    this.button(right, "settings", "Customize", () => new CategoryModal(this.app, this.categories).open());
    this.button(right, "sticky-note", "Document notes", () => {
      this.root.toggleClass("pdfaw-show-notes", !this.root.hasClass("pdfaw-show-notes"));
      if (this.root.hasClass("pdfaw-show-notes")) this.noteInput.focus();
    });

    const body = this.root.createDiv({ cls: "pdfaw-body" });
    const sidebar = body.createDiv({ cls: "pdfaw-pages" });
    this.thumbnails = sidebar.createDiv({ cls: "pdfaw-thumbnails" });
    this.viewport = body.createDiv({ cls: "pdfaw-viewport" });
    this.stage = this.viewport.createDiv({ cls: "pdfaw-stage" });
    this.groupsEl = this.stage.createDiv({ cls: "pdfaw-groups" });
    this.pageEl = this.stage.createDiv({ cls: "pdfaw-page" });
    this.links = svg(this.stage, "svg", { class: "pdfaw-connections", "aria-hidden": "true" });
    this.cardsEl = this.stage.createDiv({ cls: "pdfaw-cards" });
    this.pages = new PdfPages(this.stage, this.win, surface => this.installPage(surface), () => this.queueDimensions(), () => this.refreshViewport());
    this.marqueeEl = this.viewport.createDiv({ cls: "pdfaw-marquee", attr: { hidden: "true" } });
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
      this.applyTheme();
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
    // Touch events let us claim two fingers without disabling native one-finger
    // scrolling/selection in Reading mode (which cancels pointer events).
    this.registerDomEvent(this.viewport, "touchstart", event => this.startPinch(event), { passive: false });
    this.registerDomEvent(this.viewport, "touchmove", event => this.movePinch(event), { passive: false });
    this.registerDomEvent(this.viewport, "touchend", event => this.endPinch(event), { passive: false });
    this.registerDomEvent(this.viewport, "touchcancel", event => this.endPinch(event), { passive: false });
    this.registerDomEvent(this.viewport, "pointerdown", event => {
      if (this.pinchActive && event.pointerType === "touch") { event.preventDefault(); event.stopPropagation(); }
    }, { capture: true });
    this.registerDomEvent(this.viewport, "pointerdown", event => this.startPan(event));
    this.registerDomEvent(this.stage, "pointerdown", event => {
      const page = (event.target as HTMLElement).closest<HTMLElement>(".pdfaw-page");
      if (!page) return;
      this.activatePage(Number(page.dataset.page));
      if (this.mode === "canvas" && (event.shiftKey || this.multiSelect) && event.button === 0) { this.selectNode(pageKey(this.currentPage), true); event.preventDefault(); return; }
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
    this.registerDomEvent(this.stage, "click", event => { if ((event.target as HTMLElement).closest(".pdfaw-page")) this.openCommentAt(event); });
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
    this.registerDomEvent(this.stage, "keyup", () => this.captureSelection());
    this.registerDomEvent(this.contentEl.ownerDocument, "selectionchange", () => {
      // Update during the native drag, before release. The browser still owns
      // selection/copy semantics; only its overlapping span paint is replaced.
      this.captureSelection();
    });
    this.registerDomEvent(this.viewport, "wheel", event => {
      if ((event.target as HTMLElement).closest(".pdfaw-comment-body")) return;
      if (this.mode === "reading" && !event.ctrlKey && !event.metaKey) {
        if (this.pageChangePending || !this.pageReady) { event.preventDefault(); return; }
        const atTop = this.viewport.scrollTop <= 2;
        const atBottom = this.viewport.scrollTop + this.viewport.clientHeight >= this.viewport.scrollHeight - 2;
        const nextPage = event.deltaY > 0 && atBottom ? this.currentPage + 1
          : event.deltaY < 0 && atTop ? this.currentPage - 1 : null;
        if (nextPage !== null && nextPage >= 1 && nextPage <= (this.pdf?.numPages ?? 1) && !this.pageChangePending) {
          event.preventDefault(); this.pageChangePending = true;
          void this.showPage(nextPage, event.deltaY < 0 ? "bottom" : "top").finally(() => { this.pageChangePending = false; });
        }
        return;
      }
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) this.zoomBy(Math.exp(-event.deltaY * 0.005), { x: event.clientX, y: event.clientY });
      else { this.camera.x -= event.deltaX || (event.shiftKey ? event.deltaY : 0); this.camera.y -= event.shiftKey ? 0 : event.deltaY; this.applyCamera(); }
    }, { passive: false });
    this.registerDomEvent(this.viewport, "contextmenu", event => this.contextMenu(event));
    this.registerDomEvent(this.root, "keydown", event => this.onKey(event));
    this.registerDomEvent(this.contentEl.ownerDocument, "keydown", event => { if (event.key === "Escape") this.commentPreview.hide(); });
    this.registerDomEvent(this.win, "resize", () => this.queuePageRaster());
    this.resizeObserver = new ResizeObserver(entries => {
      this.queuePageRaster();
      if (this.mode === "reading") {
        // Rebuilding hidden canvas cards also sends resize notifications.
        // Only a viewport resize changes the Reading layout or its previews.
        if (entries.some(entry => entry.target === this.viewport)) this.applyCamera();
      } else {
        if (entries.some(entry => entry.target !== this.viewport)) { this.measureCards(); this.queueGeometry(); }
      }
    });
    this.resizeObserver.observe(this.viewport);
    this.register(() => this.resizeObserver?.disconnect());
  }

  private get layout(): BoardLayout { return this.sidecar!.canvasLayout ??= emptyLayout(); }
  private measureCards() { for (const [id, card] of this.cards) { const height = card.offsetHeight; if (height) this.cardSizes.set(id, height); } }
  private cardHeights() { this.measureCards(); return new Map(this.cardSizes); }
  private queueDimensions() {
    if (this.dimensionFrame) return;
    this.dimensionFrame = this.win.requestAnimationFrame(() => { this.dimensionFrame = 0; this.updateDimensions(); });
  }
  private updateDimensions() {
    if (!this.sidecar) return;
    this.win.cancelAnimationFrame(this.dimensionFrame); this.dimensionFrame = 0;
    const prior = this.layout.pages[this.currentPage];
    for (const number of this.autoPages) delete this.layout.pages[number];
    for (const id of this.autoCards) delete this.layout.cards[id];
    this.ensureBoard();
    const next = this.layout.pages[this.currentPage], surface = this.pages.surfaces.get(this.currentPage);
    if (surface) { this.pageWidth = surface.width; this.pageHeight = surface.height; }
    if (prior && next && this.mode === "canvas") { this.camera.x += (prior.x - next.x) * this.camera.zoom; this.camera.y += (prior.y - next.y) * this.camera.zoom; }
    this.applyLayout(); this.applyCamera();
    if (this.layoutSaved) void this.save();
  }
  private ensureBoard() { if (this.sidecar && this.pages.surfaces.size) ensureLayout(this.layout, this.pages.sizes, this.sidecar.annotations, this.cardHeights()); }
  private installPage(surface: PageSurface) {
    surface.header.onpointerdown = event => this.startNodeDrag(event, pageKey(surface.number), surface.header);
    surface.header.onfocus = () => { this.activatePage(surface.number); this.selectNode(pageKey(surface.number), false, true); };
    surface.header.ondblclick = () => { this.activatePage(surface.number); this.setMode("reading"); };
  }
  private nodeBounds(): Map<string, Bounds> {
    const boxes = new Map<string, Bounds>();
    if (!this.sidecar) return boxes;
    for (const surface of this.pages.surfaces.values()) {
      const pos = this.layout.pages[surface.number]; if (pos) boxes.set(pageKey(surface.number), { ...pos, width: surface.width, height: surface.height });
    }
    for (const annotation of this.sidecar.annotations) boxes.set(cardKey(annotation.id), { ...this.position(annotation), width: CARD_WIDTH, height: this.cardSizes.get(annotation.id) ?? estimatedHeight(annotation) });
    return boxes;
  }
  private applyLayout(changed?: Set<string>) {
    if (!this.sidecar) return;
    for (const surface of this.pages.surfaces.values()) {
      if (changed && !changed.has(pageKey(surface.number))) continue;
      const pos = this.mode === "canvas" ? this.layout.pages[surface.number] : { x: 0, y: 0 };
      if (pos) { surface.shell.style.left = `${pos.x}px`; surface.shell.style.top = `${pos.y}px`; }
      surface.shell.hidden = this.mode === "reading" && surface.number !== this.currentPage;
    }
    for (const [id, el] of this.cards) {
      if (changed && !changed.has(cardKey(id))) continue;
      const pos = this.layout.cards[id]; if (pos) { el.style.left = `${pos.x}px`; el.style.top = `${pos.y}px`; }
    }
    this.queueGeometry(); this.queuePageRaster();
  }
  private renderGroups() {
    if (!this.sidecar) return;
    const boxes = this.nodeBounds(), ids = new Set(this.layout.groups.map(g => g.id));
    for (const [id, el] of this.groupElements) if (!ids.has(id)) { el.remove(); this.groupElements.delete(id); }
    for (const group of this.layout.groups) {
      let el = this.groupElements.get(group.id);
      if (!el) {
        el = this.groupsEl.createDiv({ cls: "pdfaw-group", attr: { "data-node": `g:${group.id}` } });
        const header = el.createDiv({ cls: "pdfaw-group-handle", attr: { tabindex: "0" } });
        header.onpointerdown = event => this.startNodeDrag(event, `g:${group.id}`, header);
        header.ondblclick = () => this.renameGroup(group.id);
        this.groupElements.set(group.id, el);
      }
      if (el.firstElementChild!.textContent !== group.name) el.firstElementChild!.textContent = group.name;
      el.toggleClass("is-selected", this.selectedNodes.has(`g:${group.id}`));
      const members = group.members.flatMap(key => boxes.has(key) ? [boxes.get(key)!] : []);
      el.hidden = !members.length;
      const box = enclosingBounds(members, 45); box.y -= 32; box.height += 32;
      const props = { left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px` };
      for (const key of ["left", "top", "width", "height"] as const) if (el.style[key] !== props[key]) el.style[key] = props[key];
    }
  }
  private toWorld(x: number, y: number): Point {
    const rect = this.viewport.getBoundingClientRect();
    return { x: (x - rect.left - this.camera.x) / this.camera.zoom, y: (y - rect.top - this.camera.y) / this.camera.zoom };
  }
  private setNodePosition(key: string, pos: Point) {
    if (key.startsWith("p:")) { this.autoPages.delete(key.slice(2)); this.layout.pages[key.slice(2)] = pos; }
    else { this.autoCards.delete(key.slice(2)); this.layout.cards[key.slice(2)] = pos; }
  }
  private expandedSelection() {
    const keys = new Set<string>();
    for (const key of this.selectedNodes) {
      if (key.startsWith("g:")) this.layout.groups.find(g => g.id === key.slice(2))?.members.forEach(member => keys.add(member));
      else keys.add(key);
    }
    const boxes = this.nodeBounds(); return new Set([...keys].filter(key => boxes.has(key)));
  }
  private selectNode(key: string, additive = false, preserve = false) {
    if (additive) { if (this.selectedNodes.has(key)) this.selectedNodes.delete(key); else this.selectedNodes.add(key); }
    else if (!preserve || !this.expandedSelection().has(key) && !this.selectedNodes.has(key)) this.selectedNodes = new Set([key]);
    this.updateSelectionPaint();
  }
  private updateSelectionPaint() {
    if (!this.sidecar) return;
    const selected = this.expandedSelection();
    for (const el of Array.from(this.stage.querySelectorAll<HTMLElement>("[data-node]"))) el.toggleClass("is-selected", selected.has(el.dataset.node!) || this.selectedNodes.has(el.dataset.node!));
    this.multiSelectButton.setAttribute("aria-pressed", String(this.multiSelect)); this.multiSelectButton.toggleClass("is-active", this.multiSelect);
    this.undoButton.disabled = !this.history.canUndo; this.redoButton.disabled = !this.history.canRedo;
    this.snapButton.setAttribute("aria-pressed", String(this.layout.snap)); this.snapButton.toggleClass("is-active", this.layout.snap);
  }
  private startNodeDrag(event: PointerEvent, key: string, element: HTMLElement) {
    if (event.button !== 0 || this.mode !== "canvas" || this.tool !== "select" || this.pinchActive) return;
    event.preventDefault(); event.stopPropagation(); this.selectNode(key, event.shiftKey || this.multiSelect, true);
    if (event.shiftKey || this.multiSelect) { this.root.focus(); return; }
    element.focus();
    this.clearSelection(); this.win.getSelection()?.removeAllRanges();
    const boxes = this.nodeBounds(), nodes = new Map<string, Point>();
    for (const member of this.expandedSelection()) { const box = boxes.get(member)!; nodes.set(member, { x: box.x, y: box.y }); }
    this.gesture = { pointer: event.pointerId, start: { x: event.clientX, y: event.clientY }, origin: { x: 0, y: 0 }, element, nodes, before: structuredClone(this.layout) };
    element.setPointerCapture(event.pointerId);
  }
  private focusPage(number: number) {
    const surface = this.pages.surfaces.get(number), pos = this.layout.pages[number]; if (!surface || !pos) return;
    this.camera = fitCamera({ ...pos, width: surface.width, height: surface.height }, this.viewport.clientWidth, Math.max(100, this.viewport.clientHeight - 100));
    this.camera.y += 65; this.applyCamera();
  }
  private commitLayout(before: BoardLayout) {
    if (this.history.commit(before, this.layout)) { this.autoPages.clear(); this.autoCards.clear(); this.applyLayout(); this.updateSelectionPaint(); void this.save(); }
  }
  private restoreLayout(redo: boolean) {
    if (!this.sidecar) return;
    this.stopGesture(); const restored = redo ? this.history.redo(this.layout) : this.history.undo(this.layout);
    if (!restored) return;
    this.sidecar.canvasLayout = restored; this.autoPages.clear(); this.autoCards.clear(); this.ensureBoard(); this.selectedNodes.clear(); this.applyLayout(); this.updateSelectionPaint(); void this.save();
  }
  private toggleSnap() { if (!this.sidecar) return; const before = structuredClone(this.layout); this.layout.snap = !this.layout.snap; this.commitLayout(before); }
  private groupSelection() {
    if (!this.sidecar) return;
    const members = [...this.expandedSelection()], data = this.sidecar; if (members.length < 2) { new Notice("Select at least two pages or comments to group."); return; }
    new GroupNameModal(this.app, "", this.categories.themeColors(), name => {
      if (this.sidecar !== data) return;
      const before = structuredClone(this.layout), valid = new Set(this.nodeBounds().keys()), kept = members.filter(key => valid.has(key)); if (kept.length < 2) return;
      this.layout.groups = this.layout.groups.map(g => ({ ...g, members: g.members.filter(key => !kept.includes(key)) })).filter(g => g.members.length);
      const id = crypto.randomUUID(); this.multiSelect = false; this.layout.groups.push({ id, name, members: kept }); this.selectedNodes = new Set([`g:${id}`]); this.commitLayout(before);
    }).open();
  }
  private renameGroup(id: string) {
    const group = this.layout.groups.find(g => g.id === id), data = this.sidecar; if (!group) return;
    new GroupNameModal(this.app, group.name, this.categories.themeColors(), name => {
      if (this.sidecar !== data) return;
      const target = this.layout.groups.find(g => g.id === id); if (!target) return;
      const before = structuredClone(this.layout); target.name = name; this.commitLayout(before);
    }).open();
  }
  private ungroupSelection() {
    const before = structuredClone(this.layout), members = this.expandedSelection();
    this.layout.groups = this.layout.groups.filter(g => !this.selectedNodes.has(`g:${g.id}`) && !g.members.every(key => members.has(key)));
    this.selectedNodes = members; this.commitLayout(before);
  }
  private addLayoutMenu(menu: Menu) {
    if (this.mode !== "canvas") return;
    menu.addSeparator();
    const group = this.selectedNodes.size === 1 ? this.layout.groups.find(g => this.selectedNodes.has(`g:${g.id}`)) : undefined;
    if (group) menu.addItem(item => item.setTitle("Rename group").setIcon("pencil").onClick(() => this.renameGroup(group.id)));
    menu.addItem(item => item.setTitle("Group selection").setIcon("group").setDisabled(this.expandedSelection().size < 2).onClick(() => this.groupSelection()));
    menu.addItem(item => item.setTitle("Ungroup selection").setIcon("ungroup").setDisabled(!this.layout.groups.some(g => this.selectedNodes.has(`g:${g.id}`) || g.members.every(key => this.expandedSelection().has(key)))).onClick(() => this.ungroupSelection()));
    menu.addItem(item => item.setTitle("Undo canvas change").setIcon("undo-2").setDisabled(!this.history.canUndo).onClick(() => this.restoreLayout(false)));
    menu.addItem(item => item.setTitle("Redo canvas change").setIcon("redo-2").setDisabled(!this.history.canRedo).onClick(() => this.restoreLayout(true)));
    menu.addItem(item => item.setTitle("Snap to grid and objects").setIcon("magnet").setChecked(this.layout.snap).onClick(() => this.toggleSnap()));
    menu.addItem(item => item.setTitle("Select all pages and comments").onClick(() => { this.selectedNodes = new Set(this.nodeBounds().keys()); this.updateSelectionPaint(); }));
    menu.addItem(item => item.setTitle("Fit PDF and comments").setIcon("scan").onClick(() => this.fit()));
    menu.addItem(item => item.setTitle("Rearrange pages and comments").setIcon("layout-dashboard").onClick(() => { void this.rearrangeCards(); }));
  }
  private contextMenu(event: MouseEvent) {
    if (!this.sidecar) return;
    event.preventDefault(); const target = event.target as HTMLElement;
    const key = target.closest<HTMLElement>("[data-node]")?.dataset.node;
    if (key?.startsWith("a:")) { const annotation = this.sidecar.annotations.find(a => cardKey(a.id) === key); if (annotation) this.cardMenu(annotation, target); return; }
    if (key && this.mode === "canvas") this.selectNode(key, false, true);
    const menu = new Menu();
    if (key?.startsWith("p:")) {
      const number = Number(key.slice(2)); this.activatePage(number); this.captureSelection();
      if (this.selection) for (const category of this.categories.active()) menu.addItem(item => item.setTitle(`Comment: ${category.label}`).setIcon(category.icon).onClick(() => this.editSelection(category.id)));
      menu.addItem(item => item.setTitle("Read page").setIcon("book-open").onClick(() => { this.setMode("reading"); void this.showPage(number); }));
      menu.addItem(item => item.setTitle("Read page comments").setIcon("messages-square").onClick(() => { this.updateSidebar(); void this.sidebars.show(COMMENTS_VIEW); }));
    }
    this.addLayoutMenu(menu); menu.showAtPosition({ x: event.clientX, y: event.clientY });
  }

  private menuPosition(el: HTMLElement) { const box = el.getBoundingClientRect(); return { x: box.left, y: box.bottom }; }
  private applyTheme() {
    applyThemeColors(this.root, this.categories.themeColors());
  }

  updateSidebar() {
    if (!this.file || !this.pdf || !this.sidecar) return;
    this.sidebars.update({ owner: this, name: this.file.name, page: this.currentPage, pages: this.pdf.numPages, annotations: this.sidecar.annotations,
      jump: page => { void this.showPage(page); }, edit: annotation => this.editAnnotation(annotation), remove: annotation => this.deleteAnnotation(annotation) });
  }
  async openAt(page = 1, annotationId?: string, remove = false) {
    await this.fileReady;
    if (page !== this.currentPage) await this.showPage(page);
    this.setMode("reading"); this.updateSidebar();
    const annotation = this.sidecar?.annotations.find(item => item.id === annotationId);
    if (annotation) { if (remove) this.deleteAnnotation(annotation); else this.editAnnotation(annotation); }
  }
  async openCanvas() { await this.fileReady; this.setMode("canvas"); }

  async onLoadFile(file: TFile) {
    this.fileReady = this.loadPdf(file);
    await this.fileReady;
  }
  private async loadPdf(file: TFile) {
    if (!this.root) await this.onOpen();
    await this.flushNotes(); this.releaseDocument();
    const generation = this.generation;
    this.file = file; this.sidecar = null;
    this.noteInput.disabled = true; this.noteInput.value = "";
    this.pageEl.remove(); this.pageEl = this.stage.createDiv({ cls: "pdfaw-page" }); this.cardsEl.empty(); this.links.replaceChildren(); this.thumbnails.empty();
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
      this.pageTotal.setText(String(pdf.numPages)); this.pageInput.max = String(pdf.numPages);
      this.pageEl.remove(); await this.pages.prepare(pdf);
      if (generation !== this.generation) return;
      this.autoPages = new Set([...this.pages.surfaces.keys()].map(String).filter(number => !this.layout.pages[number]));
      this.autoCards = new Set(data.annotations.filter(a => !this.layout.cards[a.id]).map(a => a.id));
      this.currentPage = 1; this.ensureBoard(); this.activatePage(1); this.renderAnnotations(); await this.showPage(1);
      if (generation !== this.generation) return;
      this.pages.prepareRemaining(); this.buildThumbnails();
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
    if (this.sidebars.context?.owner === this) this.sidebars.update(null);
    this.resetPinch();
    this.commentPreview.hide();
    this.selectionPointer = null; this.commentPress = null; this.pageChangePending = false;
    this.generation++; this.pageGeneration++; this.pages?.clear(); this.history.clear(); this.selectedNodes.clear(); this.multiSelect = false; this.canvasCamera = null;
    this.win.cancelAnimationFrame(this.rasterFrame); this.rasterFrame = 0;
    this.win.cancelAnimationFrame(this.dimensionFrame); this.dimensionFrame = 0;
    this.win.cancelAnimationFrame(this.geometryFrame); this.geometryFrame = 0;
    this.autoPages.clear(); this.autoCards.clear(); this.layoutSaved = false;
    this.cardSizes.clear(); this.cardSignatures.clear(); this.connections.clear(); this.thumbQueue = []; this.thumbRunning = false;
    this.groupElements.clear(); this.groupsEl?.empty();
    this.thumbObserver?.disconnect();
    for (const task of this.renderTasks) task.cancel();
    this.renderTasks.clear();
    if (this.loading) void this.loading.destroy().catch(() => {});
    this.loading = null; this.pdf = null; this.pageReady = false;
    this.clearSelection(); this.cards.forEach(card => this.resizeObserver?.unobserve(card));
    this.cards.clear(); this.thumbButtons.clear();
    this.gesture = null; this.activeId = null;
  }
  private async flushNotes() {
    if (this.notesTimer !== undefined) { this.win.clearTimeout(this.notesTimer); this.notesTimer = undefined; await this.save(); }
    await this.saveQueue;
  }
  private save(): Promise<void> {
    if (!this.sidecar) return Promise.resolve();
    this.layoutSaved = true;
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

  private async renderCanvas(page: pdfjs.PDFPageProxy, canvas: HTMLCanvasElement, scale: number, density: number) {
    const viewport = page.getViewport({ scale });
    canvas.width = Math.ceil(viewport.width * density); canvas.height = Math.ceil(viewport.height * density);
    canvas.setCssProps({ "--canvas-width": `${viewport.width}px`, "--canvas-height": `${viewport.height}px` });
    const context = canvas.getContext("2d"); if (!context) throw new Error("Canvas unavailable.");
    const task = page.render({ canvasContext: context, viewport, transform: [canvas.width / viewport.width, 0, 0, canvas.height / viewport.height, 0, 0] });
    this.renderTasks.add(task);
    try { await task.promise; } finally { this.renderTasks.delete(task); }
  }
  private queuePageRaster() {
    if (this.rasterFrame || !this.pdf) return;
    this.rasterFrame = this.win.requestAnimationFrame(() => this.refreshViewport());
  }
  private refreshViewport() {
    this.win.cancelAnimationFrame(this.rasterFrame); this.rasterFrame = 0;
    if (!this.sidecar || !this.pages.surfaces.size) return;
    this.pages.update(this.mode, this.currentPage, this.camera.zoom, this.viewport, this.camera, this.layout.pages);
    if (this.sidecar.annotations.length > 80 && this.syncCards()) { this.measureCards(); this.updateSelectionPaint(); this.queueGeometry(); }
  }
  private activatePage(pageNumber: number) {
    const surface = this.pages.surfaces.get(pageNumber); if (!surface) return;
    const previous = this.currentPage;
    this.currentPage = pageNumber; this.pageEl = surface.body;
    this.pageWidth = surface.width; this.pageHeight = surface.height;
    this.pageReady = !!surface.canvas && !!surface.textLayer;
    this.pageInput.value = String(pageNumber);
    for (const number of new Set([previous, pageNumber])) {
      const button = this.thumbButtons.get(number); if (button) { button.toggleClass("is-active", number === pageNumber); button.setAttribute("aria-current", number === pageNumber ? "page" : "false"); }
    }
    if (previous !== pageNumber) this.updateSidebar();
  }
  private async showPage(pageNumber: number, edge: "top" | "bottom" = "top") {
    if (!this.pdf || !Number.isInteger(pageNumber) || !this.pages.surfaces.has(pageNumber)) return;
    this.resetPinch(); this.stopGesture(); this.clearSelection(); this.win.getSelection()?.removeAllRanges(); this.commentPreview.hide();
    const token = ++this.pageGeneration; this.pageReady = false;
    try { if (!this.pages.surfaces.get(pageNumber)!.page) await this.pages.loadPage(pageNumber); }
    catch (error) {
      if (token !== this.pageGeneration) return;
      this.pageReady = !!this.pageCanvas; this.pageInput.value = String(this.currentPage);
      new Notice(`Could not load page ${pageNumber}. Select it again to retry.`);
      console.warn("Remark My Words: page navigation", error); return;
    }
    if (token !== this.pageGeneration) return;
    if (this.dimensionFrame) this.updateDimensions();
    this.activatePage(pageNumber); this.pageReady = false;
    this.thumbButtons.get(pageNumber)?.scrollIntoView({ block: "nearest" });
    if (this.mode === "reading") this.renderAnnotations(); else { this.syncCards(); this.applyLayout(); this.updateSidebar(); }
    if (this.mode === "canvas") this.focusPage(pageNumber); else this.fit();
    await this.pages.ensure(pageNumber);
    if (token !== this.pageGeneration) return;
    this.pageReady = !!this.pageCanvas;
    if (this.mode === "reading") this.viewport.scrollTop = edge === "bottom" ? this.viewport.scrollHeight : 0;
  }
  private buildThumbnails() {
    this.thumbnails.empty(); const generation = this.generation;
    this.thumbObserver = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        this.thumbObserver?.unobserve(entry.target);
        const button = entry.target as HTMLButtonElement;
        this.thumbQueue.push(Number(button.dataset.page));
        void this.pumpThumbnails(generation);
      }
    }, { root: this.thumbnails, rootMargin: "200px" });
    for (let page = 1; page <= this.pdf!.numPages; page++) {
      const button = this.thumbnails.createEl("button", { cls: "pdfaw-thumbnail", attr: { "aria-label": `Page ${page}`, "data-page": String(page) } });
      button.createDiv({ cls: "pdfaw-thumbnail-paper" }); button.createSpan({ text: String(page) });
      button.onclick = () => void this.showPage(page);
      button.toggleClass("is-active", page === this.currentPage); button.setAttribute("aria-current", page === this.currentPage ? "page" : "false");
      this.thumbButtons.set(page, button); this.thumbObserver.observe(button);
    }
  }
  private async pumpThumbnails(generation: number) {
    if (this.thumbRunning) return;
    this.thumbRunning = true;
    try {
      while (generation === this.generation && this.thumbQueue.length) {
        const number = this.thumbQueue.shift()!, button = this.thumbButtons.get(number);
        if (button) await this.renderThumbnail(number, button, generation);
        await new Promise<void>(resolve => this.win.setTimeout(resolve, 16));
      }
    } finally { if (generation === this.generation) this.thumbRunning = false; }
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
  private visibleAnnotations() { return (this.mode === "canvas" ? this.sidecar?.annotations ?? [] : this.pageAnnotations()).filter(annotation => this.mode === "reading" || !this.filter || annotation.category === this.filter); }
  private position(annotation: Annotation): Point { return this.sidecar?.canvasLayout?.cards[annotation.id] ?? annotation.position ?? defaultPosition(this.pageAnnotations().indexOf(annotation), this.pageWidth); }

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
    for (const annotation of this.sidecar?.annotations ?? []) {
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
    this.ensureBoard();
    const overlays = new Map<number, HTMLDivElement>();
    for (const surface of this.pages.surfaces.values()) {
      surface.body.querySelector(".pdfaw-highlights")?.remove();
      overlays.set(surface.number, surface.body.createDiv({ cls: "pdfaw-highlights" }));
    }
    for (const annotation of this.visibleAnnotations()) {
      const category = this.categories.forAnnotation(annotation);
      for (const quad of annotation.quads) {
        const highlight = overlays.get(annotation.page)?.createDiv({ cls: `pdfaw-highlight${this.activeId === annotation.id ? " is-active" : ""}` });
        if (!highlight) continue;
        Object.assign(highlight.style, { left: `${quad.x}px`, top: `${quad.y}px`, width: `${quad.w}px`, height: `${quad.h}px`, backgroundColor: category.hex });
      }
    }
    this.syncCards(); this.measureCards();
    this.status.setText(`${this.file?.name ?? "PDF"}  /  Page ${this.currentPage}  ·  ${this.visibleAnnotations().length} of ${this.sidecar?.annotations.length ?? 0} annotations`);
    this.applyLayout(); this.updateSelectionPaint();
    if (this.sidebars.context?.owner === this || this.app.workspace.getActiveViewOfType(PdfAnnotatorView) === this) this.updateSidebar();
  }
  private createCard(annotation: Annotation): HTMLDivElement {
    const category = this.categories.forAnnotation(annotation);
    const card = this.cardsEl.createDiv({ cls: "pdfaw-comment-card", attr: { tabindex: "0", "aria-label": `${category.label}: ${annotation.title || annotation.text}`, "data-id": annotation.id, "data-node": cardKey(annotation.id) } });
    card.style.setProperty("--category", category.hex);
    const position = this.position(annotation);
    card.style.left = `${position.x}px`; card.style.top = `${position.y}px`; card.toggleClass("is-active", this.activeId === annotation.id);
    const header = card.createDiv({ cls: "pdfaw-card-header" });
    const badge = header.createDiv({ cls: "pdfaw-badge" });
    setIcon(badge.createSpan(), category.icon); badge.createSpan({ text: category.label });
    this.button(header, "ellipsis", "Comment actions", () => this.cardMenu(annotation, header));
    header.onpointerdown = event => { if (!(event.target as HTMLElement).closest("button")) this.startNodeDrag(event, cardKey(annotation.id), header); };
    card.onpointerdown = event => { if (event.button === 0 && !(event.target as HTMLElement).closest("button, .pdfaw-card-header")) { this.selectNode(cardKey(annotation.id), event.shiftKey || this.multiSelect); if (event.shiftKey || this.multiSelect) event.preventDefault(); } };
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
    card.onfocus = () => this.selectNode(cardKey(annotation.id), false, true);
    card.ondblclick = event => { if (!(event.target as HTMLElement).closest("button")) this.editAnnotation(annotation); };
    card.onkeydown = event => {
      if (event.target !== card) return;
      if (event.key === "Enter") { event.preventDefault(); this.editAnnotation(annotation); }
    };
    return card;
  }
  private syncCards(forceAll = false): boolean {
    if (!this.sidecar) return false;
    const virtual = !forceAll && this.sidecar.annotations.length > 80;
    const z = this.camera.zoom, margin = 240 / z;
    const area = { x: -this.camera.x / z - margin, y: -this.camera.y / z - margin, width: this.viewport.clientWidth / z + margin * 2, height: this.viewport.clientHeight / z + margin * 2 };
    const wanted = new Set<string>(); let changed = false; let previous: HTMLElement | null = null;
    const selection = this.win.getSelection();
    for (const annotation of this.visibleAnnotations()) {
      const existing = this.cards.get(annotation.id), position = this.position(annotation);
      const pinned = existing && (existing.contains(this.contentEl.ownerDocument.activeElement) || !!selection?.anchorNode && !selection.isCollapsed && existing.contains(selection.anchorNode) || this.gesture?.nodes?.has(cardKey(annotation.id)));
      if (virtual && !pinned && (this.mode === "reading" || !intersects(area, { ...position, width: CARD_WIDTH, height: this.cardSizes.get(annotation.id) ?? estimatedHeight(annotation) }))) continue;
      wanted.add(annotation.id);
      const signature = JSON.stringify([annotation.category, this.categories.forAnnotation(annotation), annotation.title, annotation.comment, annotation.text, annotation.tags, annotation.updatedAt]);
      if (!existing || this.cardSignatures.get(annotation.id) !== signature) {
        if (existing) { this.resizeObserver?.unobserve(existing); existing.remove(); }
        const card = this.createCard(annotation); this.cards.set(annotation.id, card); this.cardSignatures.set(annotation.id, signature); this.resizeObserver?.observe(card); changed = true;
      }
      const card = this.cards.get(annotation.id)!;
      const before: ChildNode | null = previous ? previous.nextSibling : this.cardsEl.firstChild;
      if (card !== before) this.cardsEl.insertBefore(card, before);
      previous = card; card.toggleClass("is-active", this.activeId === annotation.id);
    }
    for (const [id, card] of this.cards) if (!wanted.has(id)) {
      this.resizeObserver?.unobserve(card); card.remove(); this.cards.delete(id); this.cardSignatures.delete(id); changed = true;
    }
    return changed;
  }
  async rearrangeCards() {
    const data = this.sidecar; if (!data) return;
    await this.pages.metadataReady; if (this.sidecar !== data) return;
    if (this.dimensionFrame) this.updateDimensions();
    this.autoPages.clear(); this.autoCards.clear(); this.syncCards(true);
    this.stopGesture(); const before = structuredClone(this.layout);
    arrangeLayout(this.layout, this.pages.sizes, this.sidecar.annotations, this.cardHeights());
    this.commitLayout(before); this.fit();
  }
  private cardMenu(annotation: Annotation, element: HTMLElement) {
    this.selectNode(cardKey(annotation.id), false, true);
    const menu = new Menu();
    menu.addItem(item => item.setTitle("Edit").setIcon("pencil").onClick(() => this.editAnnotation(annotation)));
    menu.addItem(item => item.setTitle("Go to passage").setIcon("locate").onClick(() => this.focusAnnotation(annotation)));
    menu.addSeparator();
    for (const category of this.categories.active()) menu.addItem(item => item.setTitle(category.label).setIcon(category.icon).setChecked(annotation.category === category.id).onClick(() => {
      annotation.category = category.id; annotation.categoryStyle = this.categories.style(category.id); annotation.color = category.color; annotation.updatedAt = Date.now(); this.renderAnnotations(); void this.save();
    }));
    menu.addSeparator();
    menu.addItem(item => item.setTitle("Delete comment").setIcon("trash-2").onClick(() => this.deleteAnnotation(annotation)));
    this.addLayoutMenu(menu);
    menu.showAtPosition(this.menuPosition(element));
  }
  private deleteAnnotation(annotation: Annotation) {
    if (!this.sidecar?.annotations.some(item => item.id === annotation.id)) return;
    const data = this.sidecar;
    this.commentPreview.hide();
    new DeleteCommentModal(this.app, annotation.title || annotation.comment || annotation.text, this.categories.themeColors(), () => {
      if (this.sidecar !== data || !data.annotations.some(item => item.id === annotation.id)) return;
      data.annotations = data.annotations.filter(item => item.id !== annotation.id);
      if (this.activeId === annotation.id) this.activeId = null;
      this.commentPreview.hide(); this.renderAnnotations(); void this.save();
    }).open();
  }
  private editAnnotation(annotation: Annotation) {
    const data = this.sidecar;
    new CommentModal(this.app, annotation, annotation.text, draft => {
      if (this.sidecar !== data) return;
      Object.assign(annotation, draft, { color: this.categories.style(draft.category, annotation.categoryStyle).color, categoryStyle: this.categories.style(draft.category, annotation.categoryStyle), updatedAt: Date.now() }); this.commentPreview.hide(); this.renderAnnotations(); void this.save();
    }, this.categories.choices(annotation), this.categories.themeColors()).open();
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
      this.clearSelection(); this.win.getSelection()?.removeAllRanges(); this.renderAnnotations(); void this.save();
    }, this.categories.active(), this.categories.themeColors()).open();
  }
  private openCommentAt(event: MouseEvent) {
    const press = this.commentPress; this.commentPress = null;
    if (this.pinchActive || this.mode !== "reading" || !this.pageReady || event.button !== 0 || event.detail !== 1 || !press || press.dragged) return;
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
    if (this.pinchActive || this.tool !== "select" || this.gesture?.nodes || this.gesture?.marquee) return;
    const selection = this.win.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed || !selection.toString().trim()) { this.clearSelection(); return; }
    const range = selection.getRangeAt(0);
    const start = range.startContainer.nodeType === 1 ? range.startContainer as Element : range.startContainer.parentElement;
    const layer = start?.closest<HTMLElement>(".pdfaw-textlayer");
    const page = layer?.closest<HTMLElement>(".pdfaw-page");
    if (!page || !this.stage.contains(page)) { this.clearSelection(); return; }
    this.activatePage(Number(page.dataset.page));
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
    this.stage?.querySelectorAll(".pdfaw-selection").forEach(el => el.remove());
  }
  private positionSelectionBar() {
    if (!this.selection) return;
    if (this.selectionPointer !== null) { this.selectionBar.hidden = true; return; }
    const q = this.selection.quads[this.selection.quads.length - 1];
    const page = (this.pages.surfaces.get(this.selection.page)?.body ?? this.pageEl).getBoundingClientRect(), viewport = this.viewport.getBoundingClientRect(), root = this.root.getBoundingClientRect();
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
    this.activatePage(annotation.page); const q = annotation.quads[0]; this.activeId = annotation.id;
    if (this.mode === "reading") { void this.showPage(annotation.page).then(() => { this.viewport.scrollTop = q.y * this.camera.zoom; }); return; }
    const origin = this.layout.pages[annotation.page]; if (!origin) return;
    this.camera.x = this.viewport.clientWidth / 2 - (origin.x + q.x + q.w / 2) * this.camera.zoom;
    this.camera.y = this.viewport.clientHeight / 2 - (origin.y + q.y) * this.camera.zoom; this.renderAnnotations(); this.applyCamera();
  }
  private setTool(tool: "select" | "hand") {
    if (this.mode === "reading") tool = "select";
    this.tool = tool; this.root.toggleClass("pdfaw-hand", tool === "hand");
    this.toolButtons.forEach((button, key) => { button.toggleClass("is-active", key === tool); button.setAttribute("aria-pressed", String(key === tool)); });
    if (tool === "hand") { this.multiSelect = false; this.updateSelectionPaint(); this.clearSelection(); this.win.getSelection()?.removeAllRanges(); }
  }
  private startPan(event: PointerEvent) {
    if (this.pinchActive || this.gesture || event.defaultPrevented) return;
    this.commentPreview.hide();
    if (this.mode === "reading") { if (!(event.target as HTMLElement).closest(".pdfaw-selection-toolbar")) this.clearSelection(); return; }
    const target = event.target as HTMLElement;
    if (target.closest("button, input, textarea, .pdfaw-filters, .pdfaw-selection-toolbar")) return;
    if (event.button !== 1 && (event.button !== 0 || (this.tool !== "hand" && target.closest("[data-node]")))) return;
    event.preventDefault(); this.clearSelection(); this.win.getSelection()?.removeAllRanges(); this.root.focus();
    const marquee = event.button === 0 && this.tool === "select" && event.pointerType !== "touch";
    this.gesture = { pointer: event.pointerId, start: { x: event.clientX, y: event.clientY }, origin: { x: this.camera.x, y: this.camera.y }, element: this.viewport,
      ...(marquee ? { marquee: this.toWorld(event.clientX, event.clientY), additive: new Set(event.shiftKey ? this.selectedNodes : []) } : {}) };
    if (marquee && !event.shiftKey) { this.selectedNodes.clear(); this.updateSelectionPaint(); }
    this.viewport.setPointerCapture(event.pointerId); this.viewport.toggleClass("is-panning", !marquee);
  }
  private moveGesture(event: PointerEvent) {
    if (this.pinchActive) return;
    const gesture = this.gesture; if (!gesture || gesture.pointer !== event.pointerId) return;
    const dx = event.clientX - gesture.start.x, dy = event.clientY - gesture.start.y;
    if (gesture.nodes) {
      let delta = { x: dx / this.camera.zoom, y: dy / this.camera.zoom };
      if (this.layout.snap && !event.altKey) {
        const boxes = this.nodeBounds();
        const original = [...gesture.nodes].flatMap(([key, point]) => { const box = boxes.get(key); return box ? [{ ...box, x: point.x, y: point.y }] : []; });
        delta = snappedDelta(enclosingBounds(original), delta, [...boxes].filter(([key]) => !gesture.nodes!.has(key)).map(([, box]) => box), 8 / this.camera.zoom);
      }
      for (const [key, origin] of gesture.nodes) this.setNodePosition(key, { x: origin.x + delta.x, y: origin.y + delta.y });
      this.applyLayout(new Set(gesture.nodes.keys()));
    } else if (gesture.marquee) {
      const point = this.toWorld(event.clientX, event.clientY), origin = gesture.marquee;
      const rect = { x: Math.min(origin.x, point.x), y: Math.min(origin.y, point.y), width: Math.abs(point.x - origin.x), height: Math.abs(point.y - origin.y) };
      this.selectedNodes = new Set(gesture.additive);
      for (const [key, box] of this.nodeBounds()) if ((!key.startsWith("a:") || this.cards.has(key.slice(2))) && intersects(rect, box)) this.selectedNodes.add(key);
      Object.assign(this.marqueeEl.style, { left: `${rect.x * this.camera.zoom + this.camera.x}px`, top: `${rect.y * this.camera.zoom + this.camera.y}px`, width: `${rect.width * this.camera.zoom}px`, height: `${rect.height * this.camera.zoom}px` });
      this.marqueeEl.hidden = false; this.updateSelectionPaint();
    } else { this.camera.x = gesture.origin.x + dx; this.camera.y = gesture.origin.y + dy; this.applyCamera(); }
  }
  private endGesture(event: PointerEvent) {
    if (this.gesture?.pointer !== event.pointerId) return;
    this.stopGesture(event.type === "pointercancel");
  }
  private stopGesture(cancel = false) {
    const gesture = this.gesture; if (!gesture) return;
    this.gesture = null;
    if (gesture.element.hasPointerCapture(gesture.pointer)) gesture.element.releasePointerCapture(gesture.pointer);
    if (gesture.before) {
      if (cancel && this.sidecar) { this.sidecar.canvasLayout = gesture.before; this.applyLayout(); }
      else this.commitLayout(gesture.before);
    }
    this.marqueeEl.hidden = true; this.viewport.removeClass("is-panning");
  }
  private pinchTouches(event: TouchEvent) {
    return Array.from(event.touches).filter(touch => {
      const target = touch.target as HTMLElement;
      return this.viewport.contains(target) && !target.closest("button, input, textarea, select, .pdfaw-filters, .pdfaw-selection-toolbar");
    });
  }
  private startPinch(event: TouchEvent) {
    const touches = this.pinchTouches(event);
    if (this.pinchActive && event.cancelable) event.preventDefault();
    if (this.pinch || touches.length < 2 || !this.pdf || !event.cancelable) return;
    const [a, b] = touches;
    const distance = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
    if (distance < 1) return;
    event.preventDefault(); this.stopGesture(true); this.commentPreview.hide();
    this.selectionPointer = null; this.commentPress = null;
    this.clearSelection(); this.win.getSelection()?.removeAllRanges();
    const zoom = this.camera.zoom, rect = this.viewport.getBoundingClientRect();
    const page = this.mode === "reading" ? this.pageEl.getBoundingClientRect() : { left: rect.left + this.camera.x, top: rect.top + this.camera.y };
    this.pinch = { ids: [a.identifier, b.identifier], distance, zoom, anchor: {
      x: ((a.clientX + b.clientX) / 2 - page.left) / zoom,
      y: ((a.clientY + b.clientY) / 2 - page.top) / zoom,
    } };
    this.pinchActive = true;
  }
  private movePinch(event: TouchEvent) {
    if (!this.pinchActive) return;
    if (event.cancelable) event.preventDefault();
    const pinch = this.pinch; if (!pinch) return;
    const touches = Array.from(event.touches);
    const a = touches.find(touch => touch.identifier === pinch.ids[0]);
    const b = touches.find(touch => touch.identifier === pinch.ids[1]);
    if (!a || !b) return;
    const center = { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
    const zoom = Math.max(this.minimumZoom(), Math.min(3, pinch.zoom * Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY) / pinch.distance));
    this.camera.zoom = zoom;
    if (this.mode === "reading") {
      this.applyCamera();
      // Measure after scaling: centered pages change their left margin as they
      // grow. Native scroll bounds may clamp the anchor at the page edges.
      const page = this.pageEl.getBoundingClientRect();
      this.viewport.scrollLeft += page.left + pinch.anchor.x * zoom - center.x;
      this.viewport.scrollTop += page.top + pinch.anchor.y * zoom - center.y;
    } else {
      const viewport = this.viewport.getBoundingClientRect();
      this.camera.x = center.x - viewport.left - pinch.anchor.x * zoom;
      this.camera.y = center.y - viewport.top - pinch.anchor.y * zoom;
      this.applyCamera();
    }
  }
  private endPinch(event: TouchEvent) {
    if (!this.pinchActive) return;
    if (event.cancelable) event.preventDefault();
    const touches = this.pinchTouches(event);
    if (!touches.length) { this.resetPinch(); return; }
    if (this.pinch?.ids.every(id => touches.some(touch => touch.identifier === id))) return;
    // Keep the remaining finger from resuming a stale pan or selection. If a
    // third finger replaces one of the pair, establish a fresh anchor.
    this.pinch = null;
    if (event.type !== "touchcancel") this.startPinch(event);
  }
  private resetPinch() { this.pinch = null; this.pinchActive = false; }
  private bounds() { return enclosingBounds([...this.nodeBounds().values()], 50); }
  private setMode(mode: "canvas" | "reading") {
    if (mode === this.mode) return;
    this.resetPinch(); this.stopGesture();
    this.commentPress = null;
    this.clearSelection(); this.win.getSelection()?.removeAllRanges();
    if (mode === "reading") this.canvasCamera = { ...this.camera };
    this.mode = mode; this.multiSelect = false; this.root.toggleClass("pdfaw-reading", mode === "reading");
    this.modeButtons.forEach((button, key) => button.setAttribute("aria-pressed", String(key === mode)));
    this.toolButtons.get("hand")!.hidden = mode === "reading";
    this.setTool("select");
    this.renderAnnotations();
    this.viewport.scrollTo(0, 0);
    if (mode === "reading") { this.applyLayout(); void this.showPage(this.currentPage); }
    else {
      if (this.canvasCamera) { this.camera = this.canvasCamera; this.applyCamera(); } else { void this.showPage(1); }
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
  private minimumZoom() { return this.mode === "reading" ? 0.1 : Math.min(0.1, fitCamera(this.bounds(), this.viewport.clientWidth, Math.max(100, this.viewport.clientHeight - 65)).zoom); }
  private zoomBy(factor: number, client?: Point) {
    const rect = this.viewport.getBoundingClientRect();
    const x = client ? client.x - rect.left : rect.width / 2, y = client ? client.y - rect.top : rect.height / 2;
    const zoom = Math.max(this.minimumZoom(), Math.min(3, this.camera.zoom * factor)), ratio = zoom / this.camera.zoom;
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
      this.zoomLabel.setText(`${zoom < 0.01 ? (zoom * 100).toFixed(1) : Math.round(zoom * 100)} %`); this.queuePageRaster(); this.positionSelectionBar(); return;
    }
    this.stage.setCssProps({ "--canvas-transform": `translate(${x}px, ${y}px) scale(${zoom})` });
    this.viewport.style.backgroundPosition = `${x}px ${y}px`; this.viewport.style.backgroundSize = `${Math.max(12, 20 * zoom)}px ${Math.max(12, 20 * zoom)}px`;
    this.zoomLabel.setText(`${zoom < 0.01 ? (zoom * 100).toFixed(1) : Math.round(zoom * 100)} %`); this.queuePageRaster(); this.positionSelectionBar();
  }
  private queueGeometry() {
    if (this.geometryFrame) return;
    this.geometryFrame = this.win.requestAnimationFrame(() => { this.geometryFrame = 0; if (this.mode === "canvas") { this.drawConnections(); this.renderGroups(); } });
  }
  private drawConnections() {
    const ids = new Set<string>();
    for (const annotation of this.visibleAnnotations()) {
      if (!this.cards.has(annotation.id)) continue;
      ids.add(annotation.id);
      const color = this.categories.forAnnotation(annotation).hex, position = this.position(annotation), origin = this.layout.pages[annotation.page] ?? { x: 0, y: 0 };
      const height = this.cardSizes.get(annotation.id) ?? estimatedHeight(annotation);
      const signature = JSON.stringify([position, origin, height, color, annotation.quads[0]]);
      let elements = this.connections.get(annotation.id);
      if (elements?.signature === signature) continue;
      const { path, anchor } = connection({ ...position, width: CARD_WIDTH, height }, { ...annotation.quads[0], x: annotation.quads[0].x + origin.x, y: annotation.quads[0].y + origin.y });
      if (!elements) {
        elements = { path: svg(this.links, "path", { "stroke-width": 2, "stroke-dasharray": "8 7", "stroke-linecap": "round", fill: "none", "vector-effect": "non-scaling-stroke" }), anchor: svg(this.links, "circle", { r: 3 }), signature: "" }; this.connections.set(annotation.id, elements);
      }
      elements.path.setAttribute("d", path); elements.path.setAttribute("stroke", color);
      elements.anchor.setAttribute("cx", String(anchor.x)); elements.anchor.setAttribute("cy", String(anchor.y)); elements.anchor.setAttribute("fill", color); elements.signature = signature;
    }
    for (const [id, elements] of this.connections) if (!ids.has(id)) { elements.path.remove(); elements.anchor.remove(); this.connections.delete(id); }
  }
  private onKey(event: KeyboardEvent) {
    if (event.key === "Escape") this.commentPreview.hide();
    if ((event.target as HTMLElement).closest("input, textarea, [contenteditable=true]")) return;
    if (this.mode === "canvas" && this.sidecar) {
      const mod = event.ctrlKey || event.metaKey, key = event.key.toLowerCase();
      if (mod && ["z", "y", "g", "a"].includes(key)) {
        event.preventDefault();
        if (key === "z" || key === "y") this.restoreLayout(key === "y" || event.shiftKey);
        if (key === "g") { if (event.shiftKey) this.ungroupSelection(); else this.groupSelection(); }
        if (key === "a") { this.selectedNodes = new Set(this.nodeBounds().keys()); this.updateSelectionPaint(); }
        return;
      }
      if (event.key === "Escape") { this.stopGesture(true); this.selectedNodes.clear(); this.multiSelect = false; this.updateSelectionPaint(); }
      if (event.key.startsWith("Arrow") && this.selectedNodes.size) {
        event.preventDefault(); const before = structuredClone(this.layout), distance = event.shiftKey ? 50 : 10, boxes = this.nodeBounds();
        for (const member of this.expandedSelection()) { const box = boxes.get(member)!; this.setNodePosition(member, { x: box.x + (event.key === "ArrowLeft" ? -distance : event.key === "ArrowRight" ? distance : 0), y: box.y + (event.key === "ArrowUp" ? -distance : event.key === "ArrowDown" ? distance : 0) }); }
        this.commitLayout(before); return;
      }
    }
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
  private sidebars!: Sidebars;
  async onload() {
    const stored: unknown = await this.loadData();
    this.categories = new CategoryStore(readCategorySettings(stored), (categories, theme) => this.saveData({ categories, theme }), readThemeColors(stored));
    this.sidebars = new Sidebars(this.app);
    this.registerView(VIEW_TYPE, leaf => new PdfAnnotatorView(leaf, this.categories, this.sidebars));
    for (const type of [COMMENTS_VIEW, PAGES_VIEW] as const) this.registerView(type, leaf => new PdfSidebar(leaf, type, this.categories, () => this.sidebars.context));
    this.registerEvent(this.app.workspace.on("active-leaf-change", leaf => {
      if (leaf?.view instanceof PdfAnnotatorView) { leaf.view.updateSidebar(); return; }
      if (leaf && [COMMENTS_VIEW, PAGES_VIEW].includes(leaf.view.getViewType())) return;
      this.sidebars.update(null);
    }));
    this.app.workspace.onLayoutReady(() => {
      const leaf = this.app.workspace.getMostRecentLeaf();
      if (leaf?.view instanceof PdfAnnotatorView) leaf.view.updateSidebar();
    });
    this.registerObsidianProtocolHandler("remark-my-words", params => {
      if (params.vault && params.vault !== this.app.vault.getName()) return;
      const file = this.app.vault.getAbstractFileByPath(params.file ?? "");
      if (file instanceof TFile && file.extension.toLowerCase() === "pdf") void this.openReader(file, Math.max(1, Number(params.page) || 1), params.comment);
    });
    this.addCommand({ id: "open-pdf-canvas", name: "Open PDF canvas", checkCallback: checking => { const view = this.app.workspace.getActiveViewOfType(PdfAnnotatorView); if (!view) return false; if (!checking) void view.openCanvas(); return true; } });
    this.addCommand({ id: "rearrange-pdf-canvas", name: "Rearrange PDF canvas", checkCallback: checking => { const view = this.app.workspace.getActiveViewOfType(PdfAnnotatorView); if (!view) return false; if (!checking) { void view.openCanvas().then(() => view.rearrangeCards()); } return true; } });
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
  private async openReader(file: TFile, page = 1, annotationId?: string, remove = false) {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE).find(leaf => leaf.view instanceof PdfAnnotatorView && leaf.view.file?.path === file.path);
    const leaf = existing ?? this.app.workspace.getLeaf("tab");
    if (!existing) await leaf.setViewState({ type: VIEW_TYPE, state: { file: file.path }, active: true });
    await leaf.loadIfDeferred(); await this.app.workspace.revealLeaf(leaf);
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    if (leaf.view instanceof PdfAnnotatorView) await leaf.view.openAt(page, annotationId, remove);
  }
  private openPdf() {
    const open = (file: TFile) => { void this.app.workspace.getLeaf(false).setViewState({ type: VIEW_TYPE, state: { file: file.path }, active: true }); };
    const active = this.app.workspace.getActiveFile();
    if (active?.extension.toLowerCase() === "pdf") open(active);
    else new PdfPicker(this.app, open, this.categories.themeColors()).open();
  }
}
