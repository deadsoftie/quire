const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const { SidecarClient } = require("./sidecar");

const DEV_SERVER_URL = "http://localhost:5173";

let sidecar;

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

  ipcMain.handle("compile", (_event, source) => sidecar.compile(source));

  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
