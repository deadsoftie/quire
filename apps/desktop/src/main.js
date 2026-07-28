const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { SidecarClient } = require("./sidecar");
const { findRootTexFile, mirrorProjectToShadow } = require("./project");
const { CompletionClient } = require("./completion");

const DEV_SERVER_URL = "http://localhost:5173";

// No project open yet: the only buffer is the throwaway placeholder,
// compiled via primary_input_buffer, which Tectonic always tags 1 --
// confirmed in the 0.6 investigation. There's no real file on disk to
// resolve a path against in this case, so sync just uses the tag
// directly instead of the path-based resolution used once a project
// (and therefore real files with their own tags) exists.
const PLACEHOLDER_TAG = 1;

let sidecar;
// { projectRoot, shadowDir, rootRelativePath, openRelativePath } | null.
// rootRelativePath is the compile entry point (what Tectonic's primary
// buffer represents); openRelativePath is whichever file the editor is
// currently showing -- they start out the same but diverge once inverse
// sync navigates into a different \input/\subfile'd file. The renderer
// never sees filesystem paths, only relative-path labels and text.
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

let completion;

app.whenReady().then(() => {
  sidecar = new SidecarClient();
  completion = new CompletionClient();

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

    currentProject = { projectRoot, shadowDir, rootRelativePath, openRelativePath: rootRelativePath };
    lastSynctexBase64 = null;

    return { rootRelativePath, initialText };
  });

  ipcMain.handle("compile", async (_event, source) => {
    let result;

    if (currentProject) {
      const { shadowDir, rootRelativePath, openRelativePath } = currentProject;

      const openTarget = path.join(shadowDir, openRelativePath);
      fs.mkdirSync(path.dirname(openTarget), { recursive: true });
      fs.writeFileSync(openTarget, source);

      // Tectonic always compiles from the root's content (that's what
      // \subfile/\input in the other files are relative to). If the
      // root itself is what's open, `source` already *is* that content;
      // otherwise read the root's shadow copy, which reflects whatever
      // was last written for it.
      const primaryText =
        openRelativePath === rootRelativePath
          ? source
          : fs.readFileSync(path.join(shadowDir, rootRelativePath), "utf8");

      result = await sidecar.compile(primaryText, shadowDir);
    } else {
      result = await sidecar.compile(source);
    }

    lastSynctexBase64 = result.synctexBase64 ?? null;
    return { pdfBase64: result.pdfBase64 };
  });

  ipcMain.handle("forwardSync", async (_event, line) => {
    if (!lastSynctexBase64) return null;

    if (!currentProject) {
      return sidecar.forwardSync(lastSynctexBase64, { tag: PLACEHOLDER_TAG, line });
    }

    // Tag 1 is always the root buffer's own tag (Tectonic's primary-input
    // quirk means resolve_path can never recover the root's real filename
    // for it -- it only ever gets back the bogus placeholder "texput").
    // So when the root itself is open, use the tag directly; only reach
    // for path-based resolution for files that have a real, resolvable
    // path in the first place.
    if (currentProject.openRelativePath === currentProject.rootRelativePath) {
      return sidecar.forwardSync(lastSynctexBase64, { tag: PLACEHOLDER_TAG, line });
    }

    const openPath = path.join(currentProject.shadowDir, currentProject.openRelativePath);
    return sidecar.forwardSync(lastSynctexBase64, {
      path: openPath,
      searchDir: currentProject.shadowDir,
      line,
    });
  });

  ipcMain.handle("inverseSync", async (_event, page, x, y) => {
    if (!lastSynctexBase64) return null;

    if (!currentProject) {
      const result = await sidecar.inverseSync(lastSynctexBase64, page, x, y);
      if (!result || result.tag !== PLACEHOLDER_TAG) return null;
      return { line: result.line, confidence: result.confidence };
    }

    const result = await sidecar.inverseSync(
      lastSynctexBase64,
      page,
      x,
      y,
      currentProject.shadowDir,
    );
    if (!result) return null;

    // Same special case as forwardSync: tag 1 means "the root document",
    // full stop -- don't trust `result.path` for it (it's the bogus
    // "texput" placeholder, which doesn't exist on disk). For every other
    // tag, `result.path` is a real resolved file inside the shadow dir.
    const targetRelativePath =
      result.tag === PLACEHOLDER_TAG
        ? currentProject.rootRelativePath
        : result.path
          ? path.relative(currentProject.shadowDir, result.path)
          : null;

    if (targetRelativePath === null) return null; // no real file behind this tag

    if (targetRelativePath === currentProject.openRelativePath) {
      return { line: result.line, confidence: result.confidence };
    }

    // Landed in a different file (e.g. a different chapter) -- switch the
    // editor to show it. Read from the shadow copy, not the original
    // project dir, so any unsaved edits to *that* file are preserved.
    const newAbsPath = path.join(currentProject.shadowDir, targetRelativePath);
    const newText = fs.readFileSync(newAbsPath, "utf8");
    currentProject.openRelativePath = targetRelativePath;

    return {
      line: result.line,
      confidence: result.confidence,
      switchedFile: { relativePath: targetRelativePath, text: newText },
    };
  });

  ipcMain.handle("complete", (_event, text, line, character) =>
    completion.complete(text, line, character),
  );

  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  completion?.stop();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
