import * as pdfjs from "pdfjs-dist";
import { PDF_SCALE } from "./model";
import type { PageSize } from "./board-model";

export type PageSurface = PageSize & {
  number: number; shell: HTMLDivElement; body: HTMLDivElement; header: HTMLDivElement;
  page: pdfjs.PDFPageProxy; canvas: HTMLCanvasElement | null; textLayer: pdfjs.TextLayer | null;
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
  constructor(private stage: HTMLElement, private win: Window, private created: (surface: PageSurface) => void) {}
  get sizes(): PageSize[] { return [...this.surfaces.values()].map(({ width, height }) => ({ width, height })); }
  async prepare(pdf: pdfjs.PDFDocumentProxy) {
    this.clear(); const token = this.generation;
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number); if (token !== this.generation) return;
      const size = page.getViewport({ scale: PDF_SCALE });
      const shell = this.stage.createDiv({ cls: "pdfaw-page-node", attr: { "data-page": String(number), "data-node": `p:${number}` } });
      shell.style.width = `${size.width}px`; shell.style.height = `${size.height}px`;
      const header = shell.createDiv({ cls: "pdfaw-page-handle", text: `Page ${number}`, attr: { tabindex: "0", "aria-label": `Move page ${number}` } });
      const body = shell.createDiv({ cls: "pdfaw-page", attr: { "data-page": String(number) } });
      body.style.width = `${size.width}px`; body.style.height = `${size.height}px`; body.style.setProperty("--scale-factor", String(PDF_SCALE));
      const surface: PageSurface = { number, shell, header, body, page, width: size.width, height: size.height, canvas: null, textLayer: null, task: null, density: 0, requested: 0, revision: 0, wanted: false, textWanted: false, failed: false, pending: null };
      this.surfaces.set(number, surface); this.created(surface);
    }
  }
  update(mode: "canvas" | "reading", current: number, zoom: number, viewport: HTMLElement) {
    this.active = current;
    const area = viewport.getBoundingClientRect(), selection = this.win.getSelection();
    const wanted: PageSurface[] = [];
    for (const surface of this.surfaces.values()) {
      surface.shell.hidden = mode === "reading" && surface.number !== current;
      const box = surface.body.getBoundingClientRect();
      const selected = !!selection?.rangeCount && !selection.isCollapsed && surface.body.contains(selection.anchorNode);
      surface.wanted = mode === "reading" ? surface.number === current : selected || (box.right >= area.left - 160 && box.left <= area.right + 160 && box.bottom >= area.top - 160 && box.top <= area.bottom + 160);
      surface.textWanted = mode === "reading" || selected || zoom >= 0.18;
      if (surface.wanted) wanted.push(surface); else this.evict(surface);
    }
    const budget = Math.min(16_777_216, 33_554_432 / Math.max(1, wanted.length));
    for (const surface of wanted) {
      const density = Math.min(zoom * (this.win.devicePixelRatio || 1), Math.sqrt(budget / (surface.width * surface.height)), 8192 / Math.max(surface.width, surface.height));
      if (Math.abs(density - surface.requested) > 0.0001) {
        surface.requested = density; surface.revision++; surface.task?.cancel();
      }
    }
    this.win.clearTimeout(this.timer);
    this.timer = this.win.setTimeout(() => { this.timer = undefined; this.pump(); }, 120);
  }
  async ensure(number: number) {
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
    const surfaces = [...this.surfaces.values()].sort((a, b) => Math.abs(a.number - this.active) - Math.abs(b.number - this.active));
    for (const surface of surfaces) {
      if (this.running >= 2) break;
      if (surface.wanted && !surface.pending && !surface.failed && (Math.abs(surface.density - surface.requested) > 0.0001 || (surface.textWanted && !surface.textLayer))) this.start(surface);
    }
  }
  private start(surface: PageSurface) {
    const token = this.generation; this.running++;
    const work = this.render(surface);
    surface.pending = work.finally(() => {
      if (surface.pending === pending) surface.pending = null;
      if (token === this.generation) { this.running--; this.pump(); }
    });
    const pending = surface.pending;
  }
  async render(surface: PageSurface) {
    const revision = surface.revision, token = this.generation, density = surface.requested;
    const valid = () => token === this.generation && surface.revision === revision && surface.wanted;
    try {
      if (!surface.canvas || Math.abs(surface.density - density) > 0.0001) {
        const viewport = surface.page.getViewport({ scale: PDF_SCALE });
        const canvas = this.stage.createEl("canvas"); canvas.setAttribute("aria-label", `PDF page ${surface.number}`);
        canvas.remove();
        canvas.width = Math.ceil(viewport.width * density); canvas.height = Math.ceil(viewport.height * density);
        canvas.setCssProps({ "--canvas-width": `${viewport.width}px`, "--canvas-height": `${viewport.height}px` });
        const context = canvas.getContext("2d"); if (!context) throw new Error("Canvas unavailable.");
        const task = surface.page.render({ canvasContext: context, viewport, transform: [canvas.width / viewport.width, 0, 0, canvas.height / viewport.height, 0, 0] });
        surface.task = task;
        try { await task.promise; } finally { if (surface.task === task) surface.task = null; }
        if (!valid()) return;
        if (surface.canvas) surface.canvas.replaceWith(canvas); else surface.body.prepend(canvas);
        surface.canvas = canvas; surface.density = density;
      }
      if (!surface.textLayer && surface.textWanted) {
        const content = await surface.page.getTextContent(); if (!valid()) return;
        const container = surface.body.createDiv({ cls: "pdfaw-textlayer" });
        const layer = new pdfjs.TextLayer({ textContentSource: content, container, viewport: surface.page.getViewport({ scale: PDF_SCALE }) });
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
  }
  clear() {
    this.generation++; this.win.clearTimeout(this.timer); this.timer = undefined; this.running = 0;
    for (const surface of this.surfaces.values()) { surface.wanted = false; this.evict(surface); surface.shell.remove(); }
    this.surfaces.clear();
  }
}
