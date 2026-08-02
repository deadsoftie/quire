import { DEFAULT_DARK_THEME_ID, DEFAULT_LIGHT_THEME_ID } from "@quire/design";
import type { PanelKind } from "./panels/types";

const PANEL_KINDS: PanelKind[] = ["file-tree", "search", "outline", "problems", "packages"];

export interface SessionState {
  /** `null` means no project is open (the empty/Welcome state) -- there's nothing to reopen. */
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
  wordWrap: boolean;
  /** A built-in or custom theme id; not validated here since custom themes load from a separate file -- resolveTheme() falls back safely if it's unknown. */
  themeId: string;
  pdfInverted: boolean;
  /** Only ever honored when a real system TeX install is actually detected at runtime. */
  useSystemTex: boolean;
  /** CM6 selection head for whichever tab was active when this was saved; other reopened tabs start at their own beginning. */
  cursor: number | null;
  /** The editor's own scroll position, in pixels, for that same active tab. Deliberately not the PDF preview's -- that regenerates from a fresh compile every launch anyway. */
  scrollTop: number | null;
}

// Pre-multi-theme sessions stored `theme: "dark" | "light"` instead of a theme id. Any non-empty
// themeId string is accepted as-is (not validated against the built-in catalog): custom themes
// load from a separate file that may not have resolved yet at this point, so resolution is
// deferred to resolveTheme(), which falls back safely if the id turns out not to exist anywhere.
function resolveThemeId(r: Record<string, unknown>, fallback: string): string {
  if (typeof r.themeId === "string" && r.themeId.length > 0) return r.themeId;
  if (r.theme === "dark") return DEFAULT_DARK_THEME_ID;
  if (r.theme === "light") return DEFAULT_LIGHT_THEME_ID;
  return fallback;
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
    wordWrap: typeof r.wordWrap === "boolean" ? r.wordWrap : fallback.wordWrap,
    themeId: resolveThemeId(r, fallback.themeId),
    pdfInverted: typeof r.pdfInverted === "boolean" ? r.pdfInverted : fallback.pdfInverted,
    useSystemTex: typeof r.useSystemTex === "boolean" ? r.useSystemTex : fallback.useSystemTex,
    cursor: typeof r.cursor === "number" ? r.cursor : fallback.cursor,
    scrollTop: typeof r.scrollTop === "number" ? r.scrollTop : fallback.scrollTop,
  };
}
