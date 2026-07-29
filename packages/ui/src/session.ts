import type { PanelKind } from "./panels/types";

// Everything that "quit and relaunch returns to identical state" covers.
// Deliberately just the fields that exist today (2.3's split, 2.5's
// pinning, 2.8's editor modes, 2.9's theme/inversion), plus the cursor
// and scroll position named directly in the acceptance criterion.
// "Open projects" is plural in the task title but singular in practice --
// this app has no multi-project/tab concept to restore more than one.
export interface SessionState {
  /** `null` means no real project was ever opened (still on the scratch placeholder) -- there's nothing to reopen. */
  projectPath: string | null;
  /** The file within the project that was open, if not the root document. */
  openUri: string | null;
  splitFraction: number;
  pinned: Record<PanelKind, boolean>;
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
