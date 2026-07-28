export {};

export interface SyncRect {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type SyncConfidence = "high" | "low";

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
    };
  }
}
