const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { StdioTransport } = require("@quire/client");

const DEV_SERVER_URL = "http://localhost:5173";

// Matches Editor.tsx's INITIAL_SOURCE; must have real body content, since an empty \begin{document}\end{document} reproducibly fails to compile.
const SCRATCH_PLACEHOLDER = "\\documentclass{article}\n\\begin{document}\nHello, world!\n\\end{document}\n";

let client;
let mainWindow;

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
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function createScratchProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quire-scratch-"));
  const file = path.join(dir, "untitled.tex");
  fs.writeFileSync(file, SCRATCH_PLACEHOLDER);
  return { projectId: dir, root: file };
}

app.whenReady().then(() => {
  client = new StdioTransport();
  const sessionFile = path.join(app.getPath("userData"), "session.json");

  // On macOS the app can outlive the window past window-all-closed, so a background event can
  // still fire after the window's gone -- isDestroyed() guards that.
  client.onEvent((event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("core-event", event);
    }
  });

  ipcMain.handle("core:openProject", (_event, r) => client.openProject(r));
  ipcMain.handle("core:setRoot", (_event, projectId, uri) => client.setRoot(projectId, uri));
  ipcMain.handle("core:closeProject", (_event, projectId) => client.closeProject(projectId));
  ipcMain.handle("core:compile", (_event, r) => client.compile(r));
  ipcMain.handle("core:cancelCompile", (_event, compileId) => client.cancelCompile(compileId));
  ipcMain.handle("core:complete", (_event, r) => client.complete(r));
  ipcMain.handle("core:outline", (_event, projectId, uri) => client.outline(projectId, uri));
  ipcMain.handle("core:prefetchPackages", (_event, projectId) => client.prefetchPackages(projectId));
  ipcMain.handle("core:bundleStatus", () => client.bundleStatus());
  ipcMain.handle("core:readFile", (_event, uri) => client.readFile(uri));
  ipcMain.handle("core:writeFile", (_event, uri, text) => client.writeFile(uri, text));

  ipcMain.handle("desktop:createScratchProject", () => createScratchProject());

  ipcMain.handle("desktop:chooseProjectFolder", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("desktop:readPdfFile", (_event, pdfPath) => new Uint8Array(fs.readFileSync(pdfPath)));

  ipcMain.handle("desktop:loadSession", () => {
    try {
      return JSON.parse(fs.readFileSync(sessionFile, "utf8"));
    } catch {
      return null; // no session file yet, or it's corrupt -- either way, nothing to restore
    }
  });

  ipcMain.handle("desktop:saveSession", (_event, session) => {
    fs.writeFileSync(sessionFile, JSON.stringify(session));
  });

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
