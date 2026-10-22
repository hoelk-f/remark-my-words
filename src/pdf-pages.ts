import * as pdfjs from "pdfjs-dist";
import { PDF_SCALE } from "./model";
import { intersects, PageSize } from "./board-model";
import type { Point } from "./model";

export type PageSurface = PageSize & {
  number: number; shell: HTMLDivElement; body: HTMLDivElement; header: HTMLDivElement;
  page: pdfjs.PDFPageProxy | null; loading: Promise<pdfjs.PDFPageProxy> | null; lastUsed: number; canvas: HTMLCanvasElement | null; textLayer: pdfjs.TextLayer | null;
  task: pdfjs.RenderTask | null; density: number; requested: number; revision: number;
  wanted: boolean; textWanted: boolean; failed: boolean; pending: Promise<void> | null;
};

/** Shared page surfaces for Reading and Canvas. Only visible pages keep rasters
 * and text layers; render concurrency and total bitmap memory are bounded. */
export class PdfPages {
  surfaces = new Map<number, PageSurface>();
  timer: number | undefined;
  private generation = 0;
  private active = 1;
  private running = 0;
  private pdf: pdfjs.PDFDocumentProxy | null = null;
  private clock = 0;
  private queue: PageSurface[] = [];
  metadataReady: Promise<void> = Promise.resolve();
  constructor(private stage: HTMLElement, private win: Window, private created: (surface: PageSurface) => void, private resized: () => void, private beforeEnsure: () => void) {}
  get sizes(): PageSize[] { return [...this.surfaces.values()].map(({ width, height }) => ({ width, height })); }
  async prepare(pdf: pdfjs.PDFDocumentProxy) {
    this.clear(); this.pdf = pdf; const token = this.generation;
    const first = await pdf.getPage(1); if (token !== this.generation) return;
    const size = first.getViewport({ scale: PDF_SCALE });
    // Lightweight placeholders make every page navigable immediately. Exact sizes
    // follow after the first page is usable; existing saved positions stay intact.
    const fragment = createFragment();
    for (let number = 1; number <= pdf.numPages; number++) {
      const shell = this.stage.createDiv({ cls: "pdfaw-page-node", attr: { "data-page": String(number), "data-node": `p:${number}` } });
      fragment.appendChild(shell);
      const header = shell.createDiv({ cls: "pdfaw-page-handle", text: `Page ${number}`, attr: { tabindex: "0", "aria-label": `Move page ${number}` } });
      const body = shell.createDiv({ cls: "pdfaw-page", attr: { "data-page": String(number) } });
      body.style.setProperty("--scale-factor", String(PDF_SCALE));
      const surface: PageSurface = { number, shell, header, body, page: number === 1 ? first : null, loading: null, lastUsed: 0, width: size.width, height: size.height, canvas: null, textLayer: null, task: null, density: 0, requested: 0, revision: 0, wanted: false, textWanted: false, failed: false, pending: null };
      this.sizeSurface(surface); this.surfaces.set(number, surface); this.created(surface);
    }
    this.stage.appendChild(fragment);
  }
  private sizeSurface(surface: PageSurface) {
    for (const el of [surface.shell, surface.body]) { el.style.width = `${surface.width}px`; el.style.height = `${surface.height}px`; }
  }
  async loadPage(number: number): Promise<pdfjs.PDFPageProxy | null> {
    const surface = this.surfaces.get(number), pdf = this.pdf, token = this.generation;
    if (!surface || !pdf) return null;
    if (surface.page) return surface.page;
    surface.loading ??= pdf.getPage(number);
    let page: pdfjs.PDFPageProxy;
    try { page = await surface.loading; } finally { surface.loading = null; }
    if (token !== this.generation) return null;
    surface.page = page;
    const size = page.getViewport({ scale: PDF_SCALE });
    if (size.width !== surface.width || size.height !== surface.height) {
      surface.width = size.width; surface.height = size.height; this.sizeSurface(surface); this.resized();
    }
    return page;
  }
  prepareRemaining() {
    const token = this.generation;
    this.metadataReady = (async () => {
      for (let number = 2; number <= this.surfaces.size; number++) {
        // Yield between batches; navigation and visible rendering take priority.
        if (number % 8 === 2) await new Promise<void>(resolve => this.win.setTimeout(resolve, 16));
        if (token !== this.generation) return;
        try { await this.loadPage(number); } catch (error) { if (token === this.generation) console.warn("Remark My Words: page dimensions", error); }
      }
    })();
  }
  update(mode: "canvas" | "reading", current: number, zoom: number, viewport: HTMLElement, camera: Point, positions: Record<string, Point>) {
    this.active = current;
    const selection = this.win.getSelection(), margin = 160 / zoom;
    const area = { x: -camera.x / zoom - margin, y: -camera.y / zoom - margin, width: viewport.clientWidth / zoom + margin * 2, height: viewport.clientHeight / zoom + margin * 2 };
    const wanted: PageSurface[] = [];
    for (const surface of this.surfaces.values()) {
      const selected = !!selection?.rangeCount && !selection.isCollapsed && surface.body.contains(selection.anchorNode);
      const pos = positions[surface.number];
      const visible = mode === "reading" ? surface.number === current : selected || !!pos && intersects(area, { ...pos, width: surface.width, height: surface.height });
      if (!visible && surface.wanted) { surface.revision++; surface.task?.cancel(); }
      surface.wanted = visible;
      surface.textWanted = mode === "reading" || selected || zoom >= 0.18;
      if (visible) { surface.lastUsed = ++this.clock; wanted.push(surface); }
    }
    // 24M pixels for visible pages, plus at most 8M / three recently used pages.
    const budget = Math.min(16_777_216, 25_165_824 / Math.max(1, wanted.length));
    for (const surface of wanted) {
      const density = Math.min(zoom * (this.win.devicePixelRatio || 1), Math.sqrt(budget / (surface.width * surface.height)), 8192 / Math.max(surface.width, surface.height));
      if (Math.abs(density - surface.requested) > 0.0001) {
        surface.requested = density; surface.revision++; surface.task?.cancel();
      }
    }
    this.trimCache();
    this.queue = wanted.sort((a, b) => Math.abs(a.number - this.active) - Math.abs(b.number - this.active));
    this.win.clearTimeout(this.timer);
    this.timer = this.win.setTimeout(() => { this.timer = undefined; this.pump(); }, 120);
  }
  private trimCache() {
    let pixels = 0, count = 0;
    const cached = [...this.surfaces.values()].filter(s => !s.wanted && (s.canvas || s.textLayer)).sort((a, b) => b.lastUsed - a.lastUsed);
    for (const surface of cached) {
      const size = surface.canvas ? surface.canvas.width * surface.canvas.height : 0;
      if (count >= 3 || pixels + size > 8_388_608) this.evict(surface);
      else { count++; pixels += size; }
    }
  }
  async ensure(number: number) {
    this.beforeEnsure();
    const surface = this.surfaces.get(number); if (!surface) return;
    surface.failed = false; surface.body.querySelectorAll(".pdfaw-error").forEach(el => el.remove());
    // Navigation must not return while the target page is still in the queue.
    while (surface.wanted) {
      if (!surface.pending && surface.canvas && (!surface.textWanted || surface.textLayer) && Math.abs(surface.density - surface.requested) < 0.0001) return;
      if (!surface.pending) this.pump();
      const pending = surface.pending ?? [...this.surfaces.values()].find(item => item.pending !== null)?.pending;
      if (!pending) return;
      await pending;
      if (surface.failed) return;
    }
  }
  private pump() {
    for (const surface of this.queue) {
      if (this.running >= 2) break;
      if (surface.wanted && !surface.pending && !surface.failed && (Math.abs(surface.density - surface.requested) > 0.0001 || (surface.textWanted && !surface.textLayer))) this.start(surface);
    }
  }
  private start(surface: PageSurface) {
    const token = this.generation; this.running++;
    const work = this.render(surface);
    surface.pending = work.finally(() => {
      if (surface.pending === pending) surface.pending = null;
      if (token === this.generation) { this.running--; this.trimCache(); if (!surface.wanted && !surface.canvas) surface.page?.cleanup(); this.pump(); }
    });
    const pending = surface.pending;
  }
  async render(surface: PageSurface) {
    const revision = surface.revision, token = this.generation, density = surface.requested;
    const valid = () => token === this.generation && surface.revision === revision && surface.wanted;
    try {
      const page = await this.loadPage(surface.number); if (!page || !valid()) return;
      if (!surface.canvas || Math.abs(surface.density - density) > 0.0001) {
        const viewport = page.getViewport({ scale: PDF_SCALE });
        const canvas = this.stage.createEl("canvas"); canvas.setAttribute("aria-label", `PDF page ${surface.number}`);
        canvas.remove();
        canvas.width = Math.ceil(viewport.width * density); canvas.height = Math.ceil(viewport.height * density);
        canvas.setCssProps({ "--canvas-width": `${viewport.width}px`, "--canvas-height": `${viewport.height}px` });
        const context = canvas.getContext("2d"); if (!context) throw new Error("Canvas unavailable.");
        const task = page.render({ canvasContext: context, viewport, transform: [canvas.width / viewport.width, 0, 0, canvas.height / viewport.height, 0, 0] });
        surface.task = task;
        try { await task.promise; } finally { if (surface.task === task) surface.task = null; }
        if (!valid()) return;
        if (surface.canvas) surface.canvas.replaceWith(canvas); else surface.body.prepend(canvas);
        surface.canvas = canvas; surface.density = density;
      }
      if (!surface.textLayer && surface.textWanted) {
        const content = await page.getTextContent(); if (!valid()) return;
        const container = surface.body.createDiv({ cls: "pdfaw-textlayer" });
        const layer = new pdfjs.TextLayer({ textContentSource: content, container, viewport: page.getViewport({ scale: PDF_SCALE }) });
        surface.textLayer = layer;
        try { await layer.render(); } catch (error) { container.remove(); if (surface.textLayer === layer) surface.textLayer = null; throw error; }
      }
    } catch (error) {
      if (!valid() || error instanceof pdfjs.RenderingCancelledException) return;
      surface.failed = true;
      surface.body.createDiv({ cls: "pdfaw-loading pdfaw-error", text: "Could not render this page. Select it in the page list to retry." });
      console.error("Remark My Words: page", error);
    }
  }
  private evict(surface: PageSurface) {
    if (!surface.canvas && !surface.textLayer && !surface.pending) return;
    surface.revision++; surface.task?.cancel(); surface.textLayer?.cancel(); surface.textLayer = null;
    surface.canvas?.remove(); surface.canvas = null; surface.body.querySelector(".pdfaw-textlayer")?.remove(); surface.density = 0;
    if (!surface.pending) surface.page?.cleanup();
  }
  clear() {
    this.generation++; this.pdf = null; this.queue = []; this.metadataReady = Promise.resolve(); this.win.clearTimeout(this.timer); this.timer = undefined; this.running = 0;
    for (const surface of this.surfaces.values()) { surface.wanted = false; this.evict(surface); surface.shell.remove(); }
    this.surfaces.clear();
  }
}
