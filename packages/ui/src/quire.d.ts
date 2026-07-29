// Typed against @quire/client's CoreApi directly, since the sandboxed renderer can't import StdioTransport itself (it spawns Node child processes).
import type { CoreApi } from "@quire/client";

declare global {
  interface Window {
    quire: CoreApi;

    // Desktop transport plumbing that isn't part of CoreApi and never will be.
    quireDesktop: {
      /** Doesn't call CoreApi.openProject -- see apps/desktop/src/main.js. */
      createScratchProject: () => Promise<{ projectId: string; root: string }>;
      /** Native folder picker; `null` if cancelled. */
      chooseProjectFolder: () => Promise<string | null>;
      /** CoreApi.readFile is text-only; this reads a compiled PDF's bytes. */
      readPdfFile: (path: string) => Promise<Uint8Array>;
    };
  }
}

export {};
