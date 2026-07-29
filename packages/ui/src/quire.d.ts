// Task 2.3 replaced the old M0/M1 ad hoc bridge (compile(source),
// openProject(), complete(text,line,character)) with the real CoreApi,
// typed against `@quire/client`'s own exported interface -- Section 4's
// rule is that packages/ui only ever reaches the core through
// packages/client, and importing its types here (rather than redeclaring
// a parallel shape by hand) is how that rule stays true for the
// renderer, which can never import `@quire/client` directly (its
// `StdioTransport` spawns Node child processes that don't exist in a
// sandboxed renderer).
import type { CoreApi } from "@quire/client";

declare global {
  interface Window {
    quire: CoreApi;

    // Capabilities that are NOT part of CoreApi and never will be --
    // each one is desktop transport plumbing the real contract has no
    // business knowing about, not a stub for something CoreApi is
    // missing:
    quireDesktop: {
      /** Filesystem-only: creates the disposable one-file project backing
       * the placeholder doc shown before any real project is opened.
       * Deliberately doesn't call `CoreApi.openProject` -- see
       * apps/desktop/src/main.js. */
      createScratchProject: () => Promise<{ projectId: string; root: string }>;
      /** Native folder picker. `null` if the user cancelled -- the result
       * (if any) is a path to hand to `CoreApi.openProject`. */
      chooseProjectFolder: () => Promise<string | null>;
      /** Reads a compiled PDF (a `CompileResponse.pdfPath`) into bytes for
       * pdf.js. `CoreApi.readFile` is LaTeX-source text, not binary, so
       * this isn't a shape CoreApi could express even if it wanted to. */
      readPdfFile: (path: string) => Promise<Uint8Array>;
    };
  }
}

export {};
