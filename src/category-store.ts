import { Annotation, CATEGORIES, Category, CategoryDefinition, CategoryStyle, categoryKey, categoryStyle, defaultCategoryStyle } from "./model";

export const CATEGORY_ICONS: Record<string, string> = { "quote": "Quote", "check-check": "Check marks", "settings-2": "Sliders", "book-open": "Book", "circle-alert": "Alert", "sticky-note": "Note", "tag": "Tag", "star": "Star", "bookmark": "Bookmark", "lightbulb": "Idea" };
export const DEFAULT_ACCENT = "#55d8c8";
const isAccent = (value: unknown): value is string => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
export const defaultCategories = (): CategoryDefinition[] => Object.entries(CATEGORIES).map(([id, style]) => ({ id: id as Category, ...style }));

export function validateCategories(value: unknown): CategoryDefinition[] {
  if (!Array.isArray(value)) throw new Error("Invalid category settings.");
  const items: unknown[] = value;
  const ids = new Set<string>(), names = new Set<string>();
  const result = items.map((item): CategoryDefinition => {
    if (!categoryStyle(item) || !("id" in item) || !categoryKey(item.id) ||
      ("archived" in item && typeof item.archived !== "boolean") || ids.has(item.id)) throw new Error("Invalid or duplicate category.");
    ids.add(item.id);
    const archived = "archived" in item && item.archived === true;
    const label = item.label.trim(), name = label.toLocaleLowerCase();
    if (!archived && names.has(name)) throw new Error("Each category needs a different name.");
    if (!archived) names.add(name);
    return { id: item.id, label, hex: item.hex, color: item.color, icon: item.icon, archived };
  });
  if (!result.some(item => !item.archived)) throw new Error("Keep at least one category.");
  return result;
}

export function readCategorySettings(raw: unknown): CategoryDefinition[] {
  if (raw === null || raw === undefined) return defaultCategories();
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid category settings. Your saved settings have not been changed.");
  if (!("categories" in raw)) return defaultCategories();
  return validateCategories(raw.categories);
}

export function readAccentColor(raw: unknown): string {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return DEFAULT_ACCENT;
  const data = raw as Record<string, unknown>;
  return isAccent(data.accentColor) ? data.accentColor : DEFAULT_ACCENT;
}

/** Shared by all PDF views in one vault. Archived definitions keep old comments readable. */
export class CategoryStore {
  private definitions: CategoryDefinition[];
  private listeners = new Set<() => void>();
  private saving = false;
  revision = 0;
  constructor(definitions = defaultCategories(), private persist: (items: CategoryDefinition[], accentColor?: string) => Promise<void> = () => Promise.resolve(), private accent = DEFAULT_ACCENT) {
    this.definitions = validateCategories(definitions);
  }
  accentColor() { return this.accent; }
  all() { return this.definitions.map(item => ({ ...item })); }
  active() { return this.all().filter(item => !item.archived); }
  preferred(): Category { return this.active().find(item => item.id === "note")?.id ?? this.active()[0].id; }
  style(id: Category, snapshot?: CategoryStyle): CategoryStyle {
    const definition = this.definitions.find(item => item.id === id);
    return definition ? { label: definition.label, hex: definition.hex, color: definition.color, icon: definition.icon } : snapshot ?? defaultCategoryStyle(id);
  }
  forAnnotation(annotation: Annotation) { return this.style(annotation.category, annotation.categoryStyle); }
  choices(current?: Annotation): CategoryDefinition[] {
    const active = this.active();
    if (current && !active.some(item => item.id === current.category)) active.push({ id: current.category, ...this.forAnnotation(current), label: `${this.forAnnotation(current).label} (deleted)` });
    return active;
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  async save(definitions: CategoryDefinition[], expectedRevision: number, accentColor = this.accent) {
    if (this.saving || expectedRevision !== this.revision) throw new Error("Categories changed in another window. Close this dialog and open it again.");
    if (!isAccent(accentColor)) throw new Error("Choose a valid accent color.");
    const next = validateCategories(definitions);
    this.saving = true;
    try {
      await this.persist(next, accentColor);
      this.definitions = next; this.accent = accentColor; this.revision++;
      this.listeners.forEach(listener => listener());
    } finally { this.saving = false; }
  }
}
