// Typed against @quire/client's CoreApi directly, since the sandboxed renderer can't import StdioTransport itself (it spawns Node child processes).
import type { CoreApi } from "@quire/client";
import type { SessionState } from "./session";
import type { ThemeDefinition } from "./theme";

// Keys matter exactly to apps/desktop/src/main.js's VIEW_MENU_CHECK_IDS -- deliberate duplication across the Electron boundary.
interface ViewMenuState {
  "file-tree": boolean;
  search: boolean;
  outline: boolean;
  problems: boolean;
  packages: boolean;
  snippets: boolean;
  focusMode: boolean;
  typewriterMode: boolean;
  proseMode: boolean;
  wordWrap: boolean;
  themeId: string;
  pdfInverted: boolean;
}

declare global {
  interface Window {
    quire: CoreApi;

    // Desktop transport plumbing that isn't part of CoreApi and never will be.
    quireDesktop: {
      /** Native folder picker; `null` if cancelled. */
      chooseProjectFolder: () => Promise<string | null>;
      /** Native folder picker that also lets the user create+name a brand-new folder inline; `null` if cancelled. */
      chooseNewProjectFolder: () => Promise<string | null>;
      /** Writes `main.tex` into `dirPath` -- the chosen template's content, or blank boilerplate when `templateId` is `null`. Rejects if `dirPath` isn't empty or `templateId` isn't a real template. */
      scaffoldProject: (dirPath: string, templateId: string | null) => Promise<void>;
      /** Native save dialog for the compiled PDF, or a `.zip` with source when `includeSource`; `dirtyText` bundles live tab text instead of disk. */
      exportProject: (options: {
        projectDir: string;
        pdfPath: string;
        includeSource: boolean;
        sourceFiles?: { path: string; dirtyText?: string }[];
      }) => Promise<string | null>;
      /** Native save-as picker rooted at the given project dir; writes an empty file and returns its path, `null` if cancelled. */
      createFile: (projectDir: string) => Promise<string | null>;
      /** Native open-file picker rooted at the given project dir; `null` if cancelled. */
      chooseFile: (projectDir: string) => Promise<string | null>;
      /** Sends a file/folder to the OS trash (recoverable) -- the Explorer's only delete affordance, deliberately outside CoreApi (no cross-platform trash concept, D5). */
      trashEntry: (targetPath: string) => Promise<void>;
      /** Opens the OS file manager with the given path selected. */
      revealInFileManager: (targetPath: string) => Promise<void>;
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
      /** Raw/unvalidated -- always run through normalizeCustomThemes before use. `[]` if there's no themes file yet (or it's unreadable). */
      loadThemes: () => Promise<unknown[]>;
      saveThemes: (themes: ThemeDefinition[]) => Promise<void>;
      /** Native save dialog for a single theme's JSON; `null` if cancelled. */
      exportTheme: (defaultFileName: string, content: string) => Promise<string | null>;
      /** Native open dialog for a single theme's JSON; raw file text (unvalidated -- run through normalizeCustomThemes), or `null` if cancelled/unreadable. */
      importTheme: () => Promise<string | null>;
      /** Native menu items dispatch by command id through this channel. Returns an unsubscribe function. */
      onMenuCommand: (handler: (id: string) => void) => () => void;
    };
  }
}

export {};
