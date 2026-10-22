import type { Annotation, Bounds, Point } from "./model";

export type BoardGroup = { id: string; name: string; members: string[] };
export type BoardLayout = { version: 1; pages: Record<string, Point>; cards: Record<string, Point>; groups: BoardGroup[]; snap: boolean };
export type PageSize = { width: number; height: number };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const point = (value: unknown): value is Point => record(value) && typeof value.x === "number" && Number.isFinite(value.x) && typeof value.y === "number" && Number.isFinite(value.y);
export const pageKey = (page: number) => `p:${page}`;
export const cardKey = (id: string) => `a:${id}`;

export function readLayout(value: unknown): BoardLayout {
  if (!record(value) || value.version !== 1 || !record(value.pages) || !record(value.cards) || !Array.isArray(value.groups) || typeof value.snap !== "boolean") throw new Error("Invalid canvas layout. The saved annotations have not been changed.");
  if (!Object.entries(value.pages).every(([key, pos]) => /^[1-9]\d*$/.test(key) && point(pos)) || !Object.values(value.cards).every(point)) throw new Error("Invalid canvas position.");
  const ids = new Set<string>(), members = new Set<string>();
  for (const group of value.groups as unknown[]) {
    if (!record(group) || typeof group.id !== "string" || ids.has(group.id) || typeof group.name !== "string" || !Array.isArray(group.members) || !group.members.every((key: unknown) => typeof key === "string" && /^(p:[1-9]\d*|a:.+)$/.test(key) && !members.has(key) && !!members.add(key))) throw new Error("Invalid canvas group.");
    ids.add(group.id);
  }
  return structuredClone(value) as BoardLayout;
}
export function emptyLayout(): BoardLayout { return { version: 1, pages: {}, cards: {}, groups: [], snap: false }; }
export function estimatedHeight(annotation: Annotation) {
  const text = annotation.comment || annotation.text;
  return 145 + Math.min(340, text.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 35)), 0) * 29) + (annotation.tags?.length ? 38 : 0);
}
export function cleanLayout(layout: BoardLayout, sizes: PageSize[], annotations: Annotation[]) {
  const valid = new Set([...sizes.map((_, index) => pageKey(index + 1)), ...annotations.map(a => cardKey(a.id))]);
  for (const id of Object.keys(layout.cards)) if (!valid.has(cardKey(id))) delete layout.cards[id];
  for (const page of Object.keys(layout.pages)) if (!valid.has(pageKey(Number(page)))) delete layout.pages[page];
  layout.groups = layout.groups.map(group => ({ ...group, members: group.members.filter(key => valid.has(key)) })).filter(group => group.members.length);
}
function annotationsByPage(annotations: Annotation[]) {
  const pages = new Map<number, Annotation[]>();
  for (const annotation of annotations) { const list = pages.get(annotation.page) ?? []; list.push(annotation); pages.set(annotation.page, list); }
  return pages;
}
/** Existing annotation.position values are page-local and are never rewritten. */
export function ensureLayout(layout: BoardLayout, sizes: PageSize[], annotations: Annotation[], heights: Map<string, number> = new Map()) {
  cleanLayout(layout, sizes, annotations);
  const byPage = annotationsByPage(annotations);
  let bottom = 0;
  sizes.forEach((size, index) => {
    const page = index + 1, items = byPage.get(page) ?? [];
    const origin = layout.pages[page] ??= { x: 0, y: bottom };
    let leftY = origin.y + 28, rightY = origin.y + 28;
    items.forEach((annotation, i) => {
      const left = i % 2 === 0;
      const pos = layout.cards[annotation.id] ??= annotation.position
        ? { x: origin.x + annotation.position.x, y: origin.y + annotation.position.y }
        : { x: origin.x + (left ? -460 : size.width + 90), y: left ? leftY : rightY };
      const end = pos.y + (heights.get(annotation.id) ?? estimatedHeight(annotation)) + 32;
      if (pos.x < origin.x) leftY = Math.max(leftY, end); else rightY = Math.max(rightY, end);
    });
    bottom = Math.max(bottom, origin.y + size.height, leftY, rightY) + 150;
  });
}
export function arrangeLayout(layout: BoardLayout, sizes: PageSize[], annotations: Annotation[], heights: Map<string, number>) {
  cleanLayout(layout, sizes, annotations);
  const byPage = annotationsByPage(annotations);
  let y = 0;
  sizes.forEach((size, index) => {
    const page = index + 1; layout.pages[page] = { x: 0, y };
    let left = y + 28, right = y + 28;
    (byPage.get(page) ?? []).forEach((annotation, i) => {
      layout.cards[annotation.id] = { x: i % 2 === 0 ? -460 : size.width + 90, y: i % 2 === 0 ? left : right };
      const height = (heights.get(annotation.id) ?? estimatedHeight(annotation)) + 32;
      if (i % 2 === 0) left += height; else right += height;
    });
    y = Math.max(y + size.height, left, right) + 150;
  });
}
export function enclosingBounds(boxes: Bounds[], padding = 0): Bounds {
  if (!boxes.length) return { x: 0, y: 0, width: 1, height: 1 };
  const x = Math.min(...boxes.map(box => box.x)) - padding, y = Math.min(...boxes.map(box => box.y)) - padding;
  return { x, y, width: Math.max(...boxes.map(box => box.x + box.width)) - x + padding, height: Math.max(...boxes.map(box => box.y + box.height)) - y + padding };
}
export const intersects = (a: Bounds, b: Bounds) => a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
export function snappedDelta(moving: Bounds, delta: Point, others: Bounds[], tolerance: number): Point {
  const out = { ...delta };
  for (const axis of ["x", "y"] as const) {
    const length = axis === "x" ? "width" : "height", start = moving[axis] + delta[axis];
    let correction = Math.round(start / 20) * 20 - start;
    if (Math.abs(correction) > tolerance) correction = 0;
    let distance = correction ? Math.abs(correction) : tolerance;
    for (const other of others) for (const edge of [0, 0.5, 1]) for (const target of [0, 0.5, 1]) {
      const gap = other[axis] + target * other[length] - start - edge * moving[length];
      if (Math.abs(gap) < distance) { correction = gap; distance = Math.abs(gap); }
    }
    out[axis] += correction;
  }
  return out;
}
export class LayoutHistory {
  private past: BoardLayout[] = [];
  private future: BoardLayout[] = [];
  commit(before: BoardLayout, after: BoardLayout) {
    if (JSON.stringify(before) === JSON.stringify(after)) return false;
    this.past.push(structuredClone(before)); if (this.past.length > 100) this.past.shift(); this.future = []; return true;
  }
  undo(current: BoardLayout) { const prior = this.past.pop(); if (prior) this.future.push(structuredClone(current)); return prior; }
  redo(current: BoardLayout) { const next = this.future.pop(); if (next) this.past.push(structuredClone(current)); return next; }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  clear() { this.past = []; this.future = []; }
}
