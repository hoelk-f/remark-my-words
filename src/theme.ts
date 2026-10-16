import type { ThemeColors } from "./category-store";

export function applyThemeColors(element: HTMLElement, theme: ThemeColors) {
  element.setCssProps({
    "--pdfaw-bg": theme.background, "--pdfaw-panel": theme.panel, "--pdfaw-border": theme.border,
    "--pdfaw-text": theme.text, "--pdfaw-muted": theme.muted, "--pdfaw-accent": theme.accent,
  });
}
