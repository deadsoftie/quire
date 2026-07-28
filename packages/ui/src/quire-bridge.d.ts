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
      ) => Promise<{ line: number; confidence: SyncConfidence } | null>;
      complete: (text: string, line: number, character: number) => Promise<CompletionItem[]>;
    };
  }
}
