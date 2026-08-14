import * as path from "node:path";

// Both runOnce() (one process per RPC call, sidecarProcess.ts) and ProjectWatcher (one long-lived
// `watch` process, projectWatcher.ts) need this. Defaults to the dev checkout's debug build;
// apps/desktop's main.js calls setSidecarPath() once at startup to override it with the packaged
// app's bundled release binary. This package has no Electron dependency of its own - it has no way
// to detect "packaged" itself, so the host tells it instead, rather than reaching for Electron
// globals (app.isPackaged, process.resourcesPath) from a package meant to stay transport-agnostic.
let sidecarPath = path.join(__dirname, "..", "..", "..", "target", "debug", "quire-sidecar");

export function setSidecarPath(resolvedPath: string) {
  sidecarPath = resolvedPath;
}

export function getSidecarPath(): string {
  return sidecarPath;
}
