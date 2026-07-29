export {};

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
      complete: (text: string, line: number, character: number) => Promise<CompletionItem[]>;
      /** Pushed unprompted when an external edit (another editor, `git
       * pull`, ...) triggers a recompile. Returns an unsubscribe function. */
      onExternalRecompile: (
        callback: (result: { pdfBase64: string } | { error: string }) => void,
      ) => () => void;
    };
  }
}
