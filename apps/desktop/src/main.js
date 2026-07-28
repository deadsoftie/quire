const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { SidecarClient } = require("./sidecar");
const { findRootTexFile, mirrorProjectToShadow } = require("./project");

const DEV_SERVER_URL = "http://localhost:5173";

let sidecar;
// { projectRoot, shadowDir, rootRelativePath } | null. The renderer never
// sees filesystem paths -- it just calls compile(text); this is main's
// bookkeeping for where to write the dirty buffer and what cwd to compile
// with.
let currentProject = null;

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

    return { rootRelativePath, initialText };
  });

  ipcMain.handle("compile", (_event, source) => {
    if (currentProject) {
      const target = path.join(currentProject.shadowDir, currentProject.rootRelativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, source);
      return sidecar.compile(source, currentProject.shadowDir);
    }
    return sidecar.compile(source);
  });

  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
