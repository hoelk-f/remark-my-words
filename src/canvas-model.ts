import { Annotation, CategoryStyle, Sidecar } from "./model";

export type PageSize = { width: number; height: number };
type Binding = { page: number; annotation?: string; sourceText?: string };
export type CanvasNode = PageSize & { id: string; type: string; x: number; y: number; text?: string; file?: string; subpath?: string; color?: string; remarkMyWords?: Binding; [key: string]: unknown };
export type CanvasEdge = { id: string; fromNode: string; toNode: string; fromSide?: string; toSide?: string; [key: string]: unknown };
export type CanvasData = {
  nodes: CanvasNode[]; edges: CanvasEdge[];
  remarkMyWords: { version: 1; pdfPath: string; pages: PageSize[]; annotations: string[] };
  [key: string]: unknown;
};
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const size = (value: unknown): value is PageSize & Record<string, unknown> => object(value) && finite(value.width) && value.width > 0 && finite(value.height) && value.height > 0;

/** Refuse unrelated/damaged files; retain unknown native/third-party fields. */
export function readCanvas(raw: string, pdfPath?: string): CanvasData {
  const data: unknown = JSON.parse(raw);
  if (!object(data) || !Array.isArray(data.nodes) || !Array.isArray(data.edges) || !object(data.remarkMyWords)) throw new Error("This is not a Remark My Words canvas.");
  const meta = data.remarkMyWords;
  if (meta.version !== 1 || typeof meta.pdfPath !== "string" || (pdfPath && meta.pdfPath !== pdfPath) || !Array.isArray(meta.pages) || !meta.pages.length || !meta.pages.every(size) || !Array.isArray(meta.annotations) || !meta.annotations.every(id => typeof id === "string")) throw new Error("Invalid PDF canvas metadata.");
  const ids = new Set<string>();
  for (const node of data.nodes as unknown[]) {
    if (!object(node) || typeof node.id !== "string" || ids.has(node.id) || !["text", "file", "link", "group"].includes(String(node.type)) || !size(node) || !finite(node.x) || !finite(node.y)) throw new Error("Invalid canvas card.");
    if (node.remarkMyWords !== undefined && (!object(node.remarkMyWords) || !Number.isInteger(node.remarkMyWords.page) || Number(node.remarkMyWords.page) < 1 || (node.remarkMyWords.annotation !== undefined && typeof node.remarkMyWords.annotation !== "string") || (node.remarkMyWords.sourceText !== undefined && typeof node.remarkMyWords.sourceText !== "string"))) throw new Error("Invalid PDF card mapping.");
    ids.add(node.id);
  }
  const edgeIds = new Set<string>();
  for (const edge of data.edges as unknown[]) {
    if (!object(edge) || typeof edge.id !== "string" || edgeIds.has(edge.id) || typeof edge.fromNode !== "string" || typeof edge.toNode !== "string" || !ids.has(edge.fromNode) || !ids.has(edge.toNode)) throw new Error("Invalid canvas connection.");
    edgeIds.add(edge.id);
  }
  return data as CanvasData;
}

export function commentText(annotation: Annotation, style: CategoryStyle, pdfPath: string, vault: string) {
  const link = `obsidian://remark-my-words?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(pdfPath)}&page=${annotation.page}&comment=${encodeURIComponent(annotation.id)}`;
  return [`## ${annotation.title || style.label}`, annotation.comment || "", `> ${annotation.text.replace(/\n/g, "\n> ")}`, `${style.label} · Page ${annotation.page}`, annotation.tags?.map(tag => `#${tag}`).join(" ") ?? "", `[Edit source comment](${link})`].filter(Boolean).join("\n\n");
}
function textHeight(text: string, width = 370) {
  const chars = Math.max(15, Math.floor((width - 40) / 8));
  return Math.max(220, Math.min(1600, 60 + text.split("\n").reduce((lines, line) => lines + Math.max(1, Math.ceil(line.length / chars)), 0) * 24));
}

/** Refresh generated content only while it still matches its last source.
 * Native edits, deleted cards, custom nodes, connections and groups survive. */
export function updateCanvas(previous: CanvasData | null, sidecar: Sidecar, pages: PageSize[], style: (annotation: Annotation) => CategoryStyle, vault: string): CanvasData {
  const data: CanvasData = previous ? structuredClone(previous) : { nodes: [], edges: [], remarkMyWords: { version: 1, pdfPath: sidecar.pdfPath, pages: [], annotations: [] } };
  const oldPages = data.remarkMyWords.pages.length;
  let bottom = data.nodes.reduce((max, node) => Math.max(max, node.y + node.height), -120) + 120;
  pages.forEach((page, index) => {
    if (index < oldPages || data.nodes.some(node => node.remarkMyWords?.page === index + 1 && !node.remarkMyWords.annotation)) return;
    data.nodes.push({ id: crypto.randomUUID(), type: "file", file: sidecar.pdfPath, subpath: `#page=${index + 1}`, x: 0, y: bottom, width: Math.ceil(page.width), height: Math.ceil(page.height) + 40, remarkMyWords: { page: index + 1 } });
    bottom += Math.ceil(page.height) + 160;
  });
  const known = new Set(data.remarkMyWords.annotations), current = new Set(sidecar.annotations.map(annotation => annotation.id));
  const removed = new Set<string>();
  for (const node of data.nodes) {
    if (!node.remarkMyWords?.annotation || current.has(node.remarkMyWords.annotation)) continue;
    if (node.text === node.remarkMyWords.sourceText) removed.add(node.id);
    else delete node.remarkMyWords;
  }
  data.nodes = data.nodes.filter(node => !removed.has(node.id));
  data.edges = data.edges.filter(edge => !removed.has(edge.fromNode) && !removed.has(edge.toNode));
  for (const annotation of sidecar.annotations) {
    const category = style(annotation), text = commentText(annotation, category, sidecar.pdfPath, vault);
    const existing = data.nodes.find(node => node.remarkMyWords?.annotation === annotation.id);
    if (existing) {
      if (existing.text === existing.remarkMyWords?.sourceText) {
        existing.text = text; existing.color = category.hex;
        existing.remarkMyWords = { page: annotation.page, annotation: annotation.id, sourceText: text };
      }
    } else if (!known.has(annotation.id)) {
      const page = data.nodes.find(node => node.remarkMyWords?.page === annotation.page && !node.remarkMyWords.annotation);
      if (!page) continue;
      const siblings = data.nodes.filter(node => node.remarkMyWords?.annotation && node.remarkMyWords.page === annotation.page);
      const left = siblings.length % 2 === 0;
      const y = Math.max(page.y + 24, ...siblings.filter(node => left ? node.x < page.x : node.x > page.x).map(node => node.y + node.height + 32));
      const id = crypto.randomUUID();
      data.nodes.push({ id, type: "text", text, color: category.hex, x: left ? page.x - 460 : page.x + page.width + 90, y, width: 370, height: textHeight(text), remarkMyWords: { page: annotation.page, annotation: annotation.id, sourceText: text } });
      data.edges.push({ id: crypto.randomUUID(), fromNode: page.id, toNode: id, fromSide: left ? "left" : "right", toSide: left ? "right" : "left", color: category.hex, toEnd: "none" });
    }
  }
  data.remarkMyWords = { version: 1, pdfPath: sidecar.pdfPath, pages, annotations: sidecar.annotations.map(annotation => annotation.id) };
  return previous ? data : arrangeCanvas(data);
}

export function arrangeCanvas(input: CanvasData): CanvasData {
  const data = structuredClone(input);
  const groups = data.nodes.filter(node => node.type === "group").map(group => ({ group, members: data.nodes.filter(node => node !== group && node.x >= group.x && node.y >= group.y && node.x + node.width <= group.x + group.width && node.y + node.height <= group.y + group.height) })).sort((a, b) => a.group.width * a.group.height - b.group.width * b.group.height);
  let y = 0;
  const pages = data.nodes.filter(node => node.remarkMyWords && !node.remarkMyWords.annotation).sort((a, b) => a.remarkMyWords!.page - b.remarkMyWords!.page);
  for (const page of pages) {
    page.x = 0; page.y = y;
    let leftY = y + 24, rightY = y + 24;
    const comments = data.nodes.filter(node => node.remarkMyWords?.annotation && node.remarkMyWords.page === page.remarkMyWords!.page);
    comments.forEach((node, index) => {
      const left = index % 2 === 0;
      node.x = left ? -node.width - 90 : page.width + 90; node.y = left ? leftY : rightY;
      if (left) leftY += node.height + 32; else rightY += node.height + 32;
      for (const edge of data.edges) if (edge.fromNode === page.id && edge.toNode === node.id) { edge.fromSide = left ? "left" : "right"; edge.toSide = left ? "right" : "left"; }
    });
    y = Math.max(y + page.height, leftY, rightY) + 120;
  }
  for (const { group, members } of groups) {
    if (!members.some(node => node.remarkMyWords)) continue;
    group.x = Math.min(...members.map(node => node.x)) - 40;
    group.y = Math.min(...members.map(node => node.y)) - 60;
    group.width = Math.max(...members.map(node => node.x + node.width)) - group.x + 40;
    group.height = Math.max(...members.map(node => node.y + node.height)) - group.y + 40;
  }
  return data;
}
