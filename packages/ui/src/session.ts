// Everything that "quit and relaunch returns to identical state" covers.
// Deliberately just the fields that exist today (2.3's split, 2.8's
// editor modes, 2.9's theme/inversion), plus the cursor and scroll
// position named directly in the acceptance criterion. Sidebar section/
// width and open tabs are 3.5.6's job, once 3.5.3 settles their shape.
// "Open projects" is plural in the task title but singular in practice --
// this app has no multi-project concept to restore more than one.
export interface SessionState {
  /** `null` means no real project was ever opened (still on the scratch placeholder) -- there's nothing to reopen. */
  projectPath: string | null;
  /** The file within the project that was open, if not the root document. */
  openUri: string | null;
  splitFraction: number;
  focusMode: boolean;
  typewriterMode: boolean;
  proseMode: boolean;
  theme: "dark" | "light";
  pdfInverted: boolean;
  /** CM6 selection head, a character offset into `openUri`'s text. */
  cursor: number | null;
  /** The editor's own scroll position, in pixels. Deliberately not the PDF preview's -- that regenerates from a fresh compile every launch anyway. */
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

  return {
    projectPath: typeof r.projectPath === "string" ? r.projectPath : fallback.projectPath,
    openUri: typeof r.openUri === "string" ? r.openUri : fallback.openUri,
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
