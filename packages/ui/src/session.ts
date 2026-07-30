import type { PanelKind } from "./panels/types";

const PANEL_KINDS: PanelKind[] = ["file-tree", "outline", "problems", "packages"];

export interface SessionState {
  /** `null` means no real project was ever opened (still on the scratch placeholder) -- there's nothing to reopen. */
  projectPath: string | null;
  /** Every tab that was open, in order. `[]` means nothing to restore. */
  openTabs: string[];
  /** Which of `openTabs` was active; not trusted blindly on restore since the file may be missing or moved. */
  activeUri: string | null;
  sidebarSection: PanelKind | null;
  sidebarWidth: number;
  splitFraction: number;
  focusMode: boolean;
  typewriterMode: boolean;
  proseMode: boolean;
  theme: "dark" | "light";
  pdfInverted: boolean;
  /** CM6 selection head for whichever tab was active when this was saved; other reopened tabs start at their own beginning. */
  cursor: number | null;
  /** The editor's own scroll position, in pixels, for that same active tab. Deliberately not the PDF preview's -- that regenerates from a fresh compile every launch anyway. */
  scrollTop: number | null;
}

export function normalizeSession(raw: unknown, fallback: SessionState): SessionState {
  if (typeof raw !== "object" || raw === null) return fallback;
  const r = raw as Record<string, unknown>;

  const openTabs = Array.isArray(r.openTabs)
    ? r.openTabs.filter((u): u is string => typeof u === "string")
    : fallback.openTabs;

  const sidebarSection =
    r.sidebarSection === null || (typeof r.sidebarSection === "string" && PANEL_KINDS.includes(r.sidebarSection as PanelKind))
      ? (r.sidebarSection as PanelKind | null)
      : fallback.sidebarSection;

  return {
    projectPath: typeof r.projectPath === "string" ? r.projectPath : fallback.projectPath,
    openTabs,
    activeUri: typeof r.activeUri === "string" ? r.activeUri : fallback.activeUri,
    sidebarSection,
    sidebarWidth: typeof r.sidebarWidth === "number" ? r.sidebarWidth : fallback.sidebarWidth,
    splitFraction: typeof r.splitFraction === "number" ? r.splitFraction : fallback.splitFraction,
    focusMode: typeof r.focusMode === "boolean" ? r.focusMode : fallback.focusMode,
    typewriterMode: typeof r.typewriterMode === "boolean" ? r.typewriterMode : fallback.typewriterMode,
    proseMode: typeof r.proseMode === "boolean" ? r.proseMode : fallback.proseMode,
    theme: r.theme === "dark" || r.theme === "light" ? r.theme : fallback.theme,
    pdfInverted: typeof r.pdfInverted === "boolean" ? r.pdfInverted : fallback.pdfInverted,
    cursor: typeof r.cursor === "number" ? r.cursor : fallback.cursor,
    scrollTop: typeof r.scrollTop === "number" ? r.scrollTop : fallback.scrollTop,
  };
}
