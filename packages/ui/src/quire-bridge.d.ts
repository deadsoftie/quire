export {};

export interface SyncRect {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type SyncConfidence = "high" | "low";

export interface CompletionItem {
  label: string;
  detail?: string;
  /** Raw LSP CompletionItemKind (a number); not mapped to anything yet. */
  kind?: number;
}

declare global {
  interface Window {
    quire: {
      compile: (source: string) => Promise<{ pdfBase64: string }>;
      openProject: () => Promise<{ rootRelativePath: string; initialText: string } | null>;
      forwardSync: (
        line: number,
      ) => Promise<{ rects: SyncRect[]; confidence: SyncConfidence } | null>;
      inverseSync: (
        page: number,
        x: number,
        y: number,
      ) => Promise<{
        line: number;
        confidence: SyncConfidence;
        /** Present when the click landed in a different file than the one
         * currently open (e.g. a different chapter) -- the editor should
         * switch to showing this content before jumping to `line`. */
        switchedFile?: { relativePath: string; text: string };
      } | null>;
      complete: (text: string, line: number, character: number) => Promise<CompletionItem[]>;
      /** Pushed unprompted when an external edit (another editor, `git
       * pull`, ...) triggers a recompile. Returns an unsubscribe function. */
      onExternalRecompile: (
        callback: (result: { pdfBase64: string } | { error: string }) => void,
      ) => () => void;
    };
  }
}
