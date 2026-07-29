const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { StdioTransport } = require("@quire/client");

const DEV_SERVER_URL = "http://localhost:5173";

// Matches `packages/ui/src/Editor.tsx`'s `INITIAL_SOURCE` in spirit --
// doesn't need to be byte-identical, since the renderer's real content
// immediately overrides this via a dirty buffer on the very first
// compile. Only needs a real `\documentclass` so `openProject`'s root
// detection (1.2) reports "inferred" instead of falling back to
// "ambiguous" for a placeholder that was never going to be ambiguous to
// a human.
const SCRATCH_PLACEHOLDER = "\\documentclass{article}\n\\begin{document}\n\\end{document}\n";

let client;
let mainWindow;
// { projectId, root, openRelativePath, openText } | null. `openText` is
// the last text the renderer sent for whatever's open -- needed so an
// externally-triggered recompile (task 1.3, now driven by `client`'s own
// `files-changed` event) has *something* to use as that file's dirty
// buffer; every other file in the project is read fresh from disk inside
// `compile()` itself, so nothing else needs tracking here.
let currentProject = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(DEV_SERVER_URL);
}

// The `CompileRequest.projectId` the real contract requires has to be a
// real directory on disk (task 1.8's `open_project`/`compile` handlers
// both derive everything from it via `PathBuf::from`) -- there's no
// "no project" compile path anymore. The renderer still compiles a
// throwaway placeholder before any folder is opened (`App.tsx`'s first
// `useEffect`), so give it a real, disposable one-file project to be a
// backing store for exactly that case.
function createScratchProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quire-scratch-"));
  const file = path.join(dir, "untitled.tex");
  fs.writeFileSync(file, SCRATCH_PLACEHOLDER);
  return { projectId: dir, root: file, openRelativePath: "untitled.tex", openText: SCRATCH_PLACEHOLDER };
}

async function compileCurrent(source) {
  if (source !== undefined) currentProject.openText = source;

  const openUri = path.join(currentProject.projectId, currentProject.openRelativePath);
  const result = await client.compile({
    projectId: currentProject.projectId,
    dirtyBuffers: [{ uri: openUri, text: currentProject.openText }],
    reason: source !== undefined ? "edit" : "manual",
  });

  if (result.status !== "ok") {
    const d = result.diagnostics[0];
    throw new Error(d ? d.rawMessage || d.message : "compile failed");
  }

  const pdfBase64 = fs.readFileSync(result.pdfPath).toString("base64");
  return { pdfBase64 };
}

app.whenReady().then(() => {
  client = new StdioTransport();
  currentProject = createScratchProject();

  // Replaces task 1.3's old `ProjectWatcher` + `handleExternalChanges`
  // wiring: `client` already starts watching internally as soon as
  // `openProject` succeeds (see `packages/client/src/StdioTransport.ts`),
  // and `compile()` itself now mirrors the *whole* file graph fresh from
  // disk on every call (task 1.8), not just the file that changed -- so
  // reacting to `files-changed` is just "recompile," no manual shadow-dir
  // mirroring needed here anymore.
  client.onEvent((event) => {
    if (event.kind !== "files-changed") return;
    if (!currentProject || event.projectId !== currentProject.projectId) return;

    compileCurrent(undefined).then(
      (result) => mainWindow?.webContents.send("externalRecompile", result),
      (err) => mainWindow?.webContents.send("externalRecompile", { error: String(err?.message ?? err) }),
    );
  });

  ipcMain.handle("openProject", async () => {
    const dialogResult = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (dialogResult.canceled || dialogResult.filePaths.length === 0) return null;

    const opened = await client.openProject({ path: dialogResult.filePaths[0] });
    const initialText = await client.readFile(opened.root);
    const rootRelativePath = path.relative(opened.projectId, opened.root);

    currentProject = {
      projectId: opened.projectId,
      root: opened.root,
      openRelativePath: rootRelativePath,
      openText: initialText,
    };

    return { rootRelativePath, initialText };
  });

  ipcMain.handle("compile", (_event, source) => compileCurrent(source));

  ipcMain.handle("complete", (_event, text, line, character) =>
    client.complete({
      projectId: currentProject?.projectId ?? "",
      uri: currentProject ? path.join(currentProject.projectId, currentProject.openRelativePath) : "",
      position: { line, column: character },
      text,
    }),
  );

  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  client?.stop();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
