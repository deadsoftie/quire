import type { PanelKind } from "./panels/types";

const PANEL_KINDS: PanelKind[] = ["file-tree", "outline", "problems", "packages"];

// Everything that "quit and relaunch returns to identical state" covers.
// Deliberately just the fields that exist today (2.3's split, 2.8's
// editor modes, 2.9's theme/inversion, 3.5's sidebar/tabs), plus the
// cursor and scroll position named directly in the acceptance criterion.
export interface SessionState {
  /** `null` means no real project was ever opened (still on the scratch placeholder) -- there's nothing to reopen. */
  projectPath: string | null;
  /** Every tab that was open, in order. `[]` means nothing to restore -- same meaning `openUri: null` had before 3.5.3. */
  openTabs: string[];
  /** Which of `openTabs` was active. Not trusted blindly on restore -- App.tsx falls back to the
   * first successfully-reopened tab if this doesn't match any of them (corrupt file, or the
   * remembered file's since been moved/deleted). */
  activeUri: string | null;
  sidebarSection: PanelKind | null;
  sidebarWidth: number;
  splitFraction: number;
  focusMode: boolean;
  typewriterMode: boolean;
  proseMode: boolean;
  theme: "dark" | "light";
  pdfInverted: boolean;
  /** CM6 selection head for whichever tab was active when this was saved -- only that one tab's
   * position is restored exactly; every other reopened tab starts at its own beginning. The
   * acceptance criterion is "the same set of open tabs," not each one's exact cursor, so this is
   * a deliberate simplification, not a gap. */
  cursor: number | null;
  /** The editor's own scroll position, in pixels, for that same active tab. Deliberately not the PDF preview's -- that regenerates from a fresh compile every launch anyway. */
  scrollTop: number | null;
}

/**
 * `session.json` on disk may predate a field this build expects (the shape has grown across
 * 2.3/2.8/2.9/3.5) or may not even be an object -- `loadSession`'s only guard is against invalid
 * JSON, not an outdated or malformed-but-parseable shape. Validate field-by-field against
 * `fallback` rather than trusting the loaded value wholesale, so a stale or corrupt session file
 * degrades to defaults instead of crashing the app on launch.
 */
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
