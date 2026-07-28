const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { SidecarClient } = require("./sidecar");
const { findRootTexFile, mirrorProjectToShadow } = require("./project");

const DEV_SERVER_URL = "http://localhost:5173";

// M0 spike: the editor only ever shows one document (the project's root
// file, or the placeholder). Tectonic always assigns tag 1 to whatever's
// compiled via primary_input_buffer, which is always our root document --
// confirmed in the 0.6 investigation, including for multi-file projects.
// So "the currently open document" and "SyncTeX tag 1" are the same thing
// for now; a real multi-file editor (tabs, tag <-> open-file mapping)
// isn't needed until sync has to reach into \input'd files too.
const ROOT_TAG = 1;

let sidecar;
// { projectRoot, shadowDir, rootRelativePath } | null. The renderer never
// sees filesystem paths -- it just calls compile(text); this is main's
// bookkeeping for where to write the dirty buffer and what cwd to compile
// with.
let currentProject = null;
// Last successful compile's SyncTeX data (base64 gz), or null if there
// hasn't been one yet. Queried fresh per forwardSync/inverseSync call --
// see apps/desktop/src/sidecar.js.
let lastSynctexBase64 = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  win.loadURL(DEV_SERVER_URL);
}

app.whenReady().then(() => {
  sidecar = new SidecarClient();

  ipcMain.handle("openProject", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (result.canceled || result.filePaths.length === 0) return null;

    const projectRoot = result.filePaths[0];
    const rootFile = findRootTexFile(projectRoot);
    if (!rootFile) {
      throw new Error("No .tex file found in the selected folder");
    }

    const shadowDir = mirrorProjectToShadow(projectRoot);
    const rootRelativePath = path.relative(projectRoot, rootFile);
    const initialText = fs.readFileSync(rootFile, "utf8");

    currentProject = { projectRoot, shadowDir, rootRelativePath };
    lastSynctexBase64 = null;

    return { rootRelativePath, initialText };
  });

  ipcMain.handle("compile", async (_event, source) => {
    const result = currentProject
      ? await (() => {
          const target = path.join(currentProject.shadowDir, currentProject.rootRelativePath);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, source);
          return sidecar.compile(source, currentProject.shadowDir);
        })()
      : await sidecar.compile(source);

    lastSynctexBase64 = result.synctexBase64 ?? null;
    return { pdfBase64: result.pdfBase64 };
  });

  ipcMain.handle("forwardSync", async (_event, line) => {
    if (!lastSynctexBase64) return null;
    return sidecar.forwardSync(lastSynctexBase64, ROOT_TAG, line);
  });

  ipcMain.handle("inverseSync", async (_event, page, x, y) => {
    if (!lastSynctexBase64) return null;
    const result = await sidecar.inverseSync(lastSynctexBase64, page, x, y);
    if (!result || result.tag !== ROOT_TAG) return null;
    return { line: result.line, confidence: result.confidence };
  });

  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
