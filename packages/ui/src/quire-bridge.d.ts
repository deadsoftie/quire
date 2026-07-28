export {};

declare global {
  interface Window {
    quire: {
      compile: (source: string) => Promise<{ pdfBase64: string }>;
      openProject: () => Promise<{ rootRelativePath: string; initialText: string } | null>;
    };
  }
}
