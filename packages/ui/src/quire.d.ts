// Typed against @quire/client's CoreApi directly, since the sandboxed renderer can't import StdioTransport itself (it spawns Node child processes).
import type { CoreApi } from "@quire/client";
import type { SessionState } from "./session";

// Keys matter exactly to apps/desktop/src/main.js's VIEW_MENU_CHECK_IDS -- deliberate duplication
// across the Electron process boundary (plain JS there, no shared TS import possible).
interface ViewMenuState {
  "file-tree": boolean;
  outline: boolean;
  problems: boolean;
  packages: boolean;
  focusMode: boolean;
  typewriterMode: boolean;
  proseMode: boolean;
  wordWrap: boolean;
  lightTheme: boolean;
  pdfInverted: boolean;
}

declare global {
  interface Window {
    quire: CoreApi;

    // Desktop transport plumbing that isn't part of CoreApi and never will be.
    quireDesktop: {
      /** Doesn't call CoreApi.openProject -- see apps/desktop/src/main.js. */
      createScratchProject: () => Promise<{ projectId: string; root: string }>;
      /** Native folder picker; `null` if cancelled. */
      chooseProjectFolder: () => Promise<string | null>;
      /** Native save-as picker rooted at the given project dir; writes an empty file and returns its path, `null` if cancelled. */
      createFile: (projectDir: string) => Promise<string | null>;
      /** Native open-file picker rooted at the given project dir; `null` if cancelled. */
      chooseFile: (projectDir: string) => Promise<string | null>;
      /** Native Save/Discard/Cancel confirm dialog, for closing dirty tabs/projects outside TabBar's own inline confirmation UI. */
      confirmDiscard: (message: string) => Promise<"save" | "discard" | "cancel">;
      /** Keeps the native View menu's checkboxes in sync with renderer state -- see App.tsx's reportViewState effect. */
      reportViewState: (state: ViewMenuState) => Promise<void>;
      /** CoreApi.readFile is text-only; this reads a compiled PDF's bytes. */
      readPdfFile: (path: string) => Promise<Uint8Array>;
      /** Writes a pasted image's bytes into `<projectDir>/figures/` (created if needed); returns the project-relative path. */
      pasteImage: (projectDir: string, bytes: Uint8Array, extension: string) => Promise<string>;
      /** `null` if there's no session file yet (or it's unreadable). */
      loadSession: () => Promise<SessionState | null>;
      saveSession: (session: SessionState) => Promise<void>;
      /** Native menu items dispatch by command id through this channel. Returns an unsubscribe function. */
      onMenuCommand: (handler: (id: string) => void) => () => void;
    };
  }
}

export {};
