import { readLayout } from "./board-model";
import type { BoardLayout } from "./board-model";
/** PDF geometry stays at the original reader's scale; camera zoom never changes it. */
export const PDF_SCALE = 1.35;
export const CARD_WIDTH = 370;
export const CATEGORIES = {
  claim: { label: "Claim", color: "orange", hex: "#ff9656", icon: "quote" },
  evidence: { label: "Evidence", color: "green", hex: "#54df94", icon: "check-check" },
  method: { label: "Method", color: "blue", hex: "#54b5ff", icon: "settings-2" },
  concept: { label: "Concept", color: "purple", hex: "#bd83f5", icon: "book-open" },
  limitation: { label: "Limitation", color: "red", hex: "#ff657e", icon: "circle-alert" },
  note: { label: "Note", color: "yellow", hex: "#f4d653", icon: "sticky-note" },
} as const;
export type Category = keyof typeof CATEGORIES | `custom-${string}`;
export type CategoryStyle = { label: string; color: string; hex: string; icon: string };
export type CategoryDefinition = CategoryStyle & { id: Category; archived?: boolean };
export type Point = { x: number; y: number };
export type Quad = Point & { w: number; h: number };
export type Annotation = {
  id: string;
  page: number;
  category: Category;
  categoryStyle?: CategoryStyle;
  color: string;
  quads: Quad[];
  text: string;
  title?: string;
  comment?: string;
  tags?: string[];
  position?: Point;
  createdAt: number;
  updatedAt: number;
};
export type Sidecar = {
  pdfPath: string;
  version: 2;
  annotations: Annotation[];
  notes: string;
  canvasLayout?: BoardLayout;
};
export type Bounds = { x: number; y: number; width: number; height: number };
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const point = (value: unknown): value is Point => record(value) && finite(value.x) && finite(value.y);
const quad = (value: unknown): value is Quad => record(value) && finite(value.x) && finite(value.y) && finite(value.w) && finite(value.h) && value.w > 0 && value.h > 0;
const unknownArray = (value: unknown): value is unknown[] => Array.isArray(value);
const stringArray = (value: unknown): value is string[] => unknownArray(value) && value.every(item => typeof item === "string");
export const categoryKey = (value: unknown): value is Category => typeof value === "string" &&
  (Object.prototype.hasOwnProperty.call(CATEGORIES, value) || /^custom-[a-z0-9-]{1,80}$/.test(value));
export const categoryStyle = (value: unknown): value is CategoryStyle => record(value) &&
  typeof value.label === "string" && value.label.trim().length > 0 && value.label.length <= 60 &&
  typeof value.color === "string" && typeof value.hex === "string" && /^#[0-9a-f]{6}$/i.test(value.hex) &&
  typeof value.icon === "string" && /^[a-z0-9-]{1,60}$/.test(value.icon);
export function defaultCategoryStyle(id: Category): CategoryStyle {
  if (Object.prototype.hasOwnProperty.call(CATEGORIES, id)) return CATEGORIES[id as keyof typeof CATEGORIES];
  return { label: "Unknown category", color: "gray", hex: "#94a3b8", icon: "tag" };
}

/** Reject invalid files rather than silently discarding annotations on the next save. */
export function readSidecar(raw: string, pdfPath: string): Sidecar {
  const data: unknown = JSON.parse(raw);
  if (!record(data) || (data.version !== 1 && data.version !== 2) || !unknownArray(data.annotations) ||
      (data.notes !== undefined && typeof data.notes !== "string")) {
    throw new Error("Unknown or damaged annotation format.");
  }
  const legacy: Record<string, Category> = { red: "limitation", yellow: "note", green: "evidence", blue: "method", orange: "note", purple: "evidence" };
  const oldCategories: Record<string, Category> = { criticism: "limitation", question: "note", positive: "evidence", unclear: "note", literature: "evidence" };
  const ids = new Set<string>();
  const annotations = data.annotations.map((a): Annotation => {
    if (!record(a) || typeof a.id !== "string" || ids.has(a.id) || !finite(a.page) || !Number.isInteger(a.page) || a.page < 1 ||
        !unknownArray(a.quads) || !a.quads.length || !a.quads.every(quad) ||
        typeof a.text !== "string" || !finite(a.createdAt) || !finite(a.updatedAt) ||
        (a.position !== undefined && !point(a.position)) ||
        (a.title !== undefined && typeof a.title !== "string") ||
        (a.comment !== undefined && typeof a.comment !== "string") ||
        (a.tags !== undefined && !stringArray(a.tags)) ||
        (a.categoryStyle !== undefined && !categoryStyle(a.categoryStyle))) {
      throw new Error("An annotation contains invalid data.");
    }
    ids.add(a.id);
    let category: Category;
    if (categoryKey(a.category)) category = a.category;
    else if (typeof a.category === "string" && Object.prototype.hasOwnProperty.call(oldCategories, a.category)) category = oldCategories[a.category];
    else if (a.category !== undefined) throw new Error("Unknown category.");
    else category = typeof a.color === "string" && Object.prototype.hasOwnProperty.call(legacy, a.color) ? legacy[a.color] : "note";
    return { ...a, id: a.id, page: a.page, text: a.text, quads: a.quads, createdAt: a.createdAt, updatedAt: a.updatedAt,
      position: a.position, title: a.title, comment: a.comment, tags: a.tags, category, categoryStyle: a.categoryStyle, color: a.categoryStyle?.color ?? defaultCategoryStyle(category).color };
  });
  if (data.canvasLayout !== undefined) data.canvasLayout = readLayout(data.canvasLayout);
  return { ...data, pdfPath, version: 2, annotations, notes: data.notes ?? "" };
}

export function defaultPosition(index: number, pageWidth: number): Point {
  return { x: index % 2 === 0 ? -CARD_WIDTH - 90 : pageWidth + 90, y: 28 + Math.floor(index / 2) * 380 };
}

/** Attach to the nearest horizontal edge of the card and the selected text. */
export function connection(card: Bounds, quad: Quad): { path: string; anchor: Point } {
  const onLeft = card.x + card.width / 2 < quad.x + quad.w / 2;
  const start = { x: onLeft ? card.x + card.width : card.x, y: card.y + Math.min(card.height / 2, 100) };
  const anchor = { x: onLeft ? quad.x : quad.x + quad.w, y: quad.y + quad.h / 2 };
  const bend = Math.max(60, Math.abs(anchor.x - start.x) * 0.48);
  const direction = onLeft ? 1 : -1;
  return { path: `M ${start.x} ${start.y} C ${start.x + bend * direction} ${start.y}, ${anchor.x - bend * direction} ${anchor.y}, ${anchor.x} ${anchor.y}`, anchor };
}

export function sceneBounds(pageWidth: number, pageHeight: number, cards: Bounds[]): Bounds {
  const left = Math.min(0, ...cards.map(c => c.x));
  const top = Math.min(0, ...cards.map(c => c.y));
  const right = Math.max(pageWidth, ...cards.map(c => c.x + c.width));
  const bottom = Math.max(pageHeight, ...cards.map(c => c.y + c.height));
  return { x: left - 45, y: top - 45, width: right - left + 90, height: bottom - top + 90 };
}

export function fitCamera(bounds: Bounds, width: number, height: number) {
  const zoom = Math.max(0.0001, Math.min(1.5, width / bounds.width, height / bounds.height));
  return { zoom, x: (width - bounds.width * zoom) / 2 - bounds.x * zoom, y: (height - bounds.height * zoom) / 2 - bounds.y * zoom };
}
