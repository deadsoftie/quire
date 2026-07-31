const { app, BrowserWindow, ipcMain, dialog, Menu } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { StdioTransport } = require("@quire/client");

const DEV_SERVER_URL = "http://localhost:5173";
const isMac = process.platform === "darwin";

// Matches Editor.tsx's INITIAL_SOURCE; must have real body content, since an empty \begin{document}\end{document} reproducibly fails to compile.
const SCRATCH_PLACEHOLDER = "\\documentclass{article}\n\\begin{document}\nHello, world!\n\\end{document}\n";

let client;
let mainWindow;

// Every non-role menu item dispatches through this single channel into the renderer's command
// registry (packages/ui/src/commands/CommandContext.tsx) by id, so a menu click, its keyboard
// accelerator, and the command palette all ultimately run the exact same command.
function sendMenuCommand(id) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("menu:command", id);
  }
}

function buildMenu() {
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    {
      label: "File",
      submenu: [
        { label: "Settings…", accelerator: "CmdOrCtrl+,", click: () => sendMenuCommand("app.open-settings") },
        { type: "separator" },
        { label: "New File", accelerator: "CmdOrCtrl+N", click: () => sendMenuCommand("file.new") },
        { label: "Open File…", accelerator: "CmdOrCtrl+Shift+O", click: () => sendMenuCommand("file.open") },
        { label: "Open Folder…", accelerator: "CmdOrCtrl+O", click: () => sendMenuCommand("project.open") },
        { type: "separator" },
        { label: "Close File", accelerator: "CmdOrCtrl+W", click: () => sendMenuCommand("file.close") },
        { label: "Close Folder", click: () => sendMenuCommand("file.close-folder") },
        { type: "separator" },
        { label: "Save", accelerator: "CmdOrCtrl+S", click: () => sendMenuCommand("file.save") },
        { label: "Save As…", accelerator: "CmdOrCtrl+Shift+S", click: () => sendMenuCommand("file.save-as") },
        ...(isMac ? [] : [{ type: "separator" }, { role: "quit" }]),
      ],
    },
    {
      label: "Edit",
      submenu: [
        // Not `role: "undo"/"redo"` -- CM6 manages its own history independently of Chromium's
        // native editable-widget undo stack, so the native role would be a silent no-op with
        // focus in the editor. These dispatch through the same command-registry path instead.
        { label: "Undo", accelerator: "CmdOrCtrl+Z", click: () => sendMenuCommand("editor.undo") },
        { label: "Redo", accelerator: "Shift+CmdOrCtrl+Z", click: () => sendMenuCommand("editor.redo") },
        { type: "separator" },
        // Cut/copy/paste/select-all DO work correctly via native roles -- CM6 integrates with the
        // browser's own clipboard/selection events for these, unlike undo/redo.
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        // Parity with the command palette (⌘K) -- everything here is already a command over
        // there; this just gives the same actions a second, discoverable surface. Checkbox
        // `checked` state is kept in sync by updateViewMenuChecks, called whenever the renderer's
        // own state changes (App.tsx's reportViewState effect), since Electron menu items don't
        // reactively bind to renderer state on their own.
        { id: "view.file-tree", label: "Show Explorer", type: "checkbox", accelerator: "CmdOrCtrl+1", click: () => sendMenuCommand("panel.file-tree") },
        { id: "view.outline", label: "Show Outline", type: "checkbox", accelerator: "CmdOrCtrl+2", click: () => sendMenuCommand("panel.outline") },
        { id: "view.problems", label: "Show Problems", type: "checkbox", accelerator: "CmdOrCtrl+3", click: () => sendMenuCommand("panel.problems") },
        { id: "view.packages", label: "Show Packages", type: "checkbox", click: () => sendMenuCommand("panel.packages") },
        { type: "separator" },
        { id: "view.focus-mode", label: "Focus Mode", type: "checkbox", click: () => sendMenuCommand("editor.toggle-focus-mode") },
        { id: "view.typewriter", label: "Typewriter Scrolling", type: "checkbox", click: () => sendMenuCommand("editor.toggle-typewriter-scrolling") },
        { id: "view.prose-mode", label: "Serif Prose Mode", type: "checkbox", click: () => sendMenuCommand("editor.toggle-prose-mode") },
        { id: "view.word-wrap", label: "Word Wrap", type: "checkbox", click: () => sendMenuCommand("editor.toggle-word-wrap") },
        { type: "separator" },
        { id: "view.light-theme", label: "Light Theme", type: "checkbox", click: () => sendMenuCommand("app.toggle-theme") },
        { id: "view.pdf-inverted", label: "Invert PDF Colors", type: "checkbox", click: () => sendMenuCommand("pdf.toggle-inversion") },
        { type: "separator" },
        { label: "Reset Editor/Preview Split", click: () => sendMenuCommand("layout.reset-split") },
        { type: "separator" },
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    ...(isMac ? [{ role: "windowMenu" }] : []),
  ];
  return Menu.buildFromTemplate(template);
}

// Keys match exactly what App.tsx's reportViewState effect sends -- deliberate duplication across
// the Electron process boundary, same as sendMenuCommand's ids (no shared TS import is possible here).
const VIEW_MENU_CHECK_IDS = {
  "file-tree": "view.file-tree",
  outline: "view.outline",
  problems: "view.problems",
  packages: "view.packages",
  focusMode: "view.focus-mode",
  typewriterMode: "view.typewriter",
  proseMode: "view.prose-mode",
  wordWrap: "view.word-wrap",
  lightTheme: "view.light-theme",
  pdfInverted: "view.pdf-inverted",
};

function updateViewMenuChecks(state) {
  const menu = Menu.getApplicationMenu();
  if (!menu) return;
  for (const [key, id] of Object.entries(VIEW_MENU_CHECK_IDS)) {
    const item = menu.getMenuItemById(id);
    if (item) item.checked = Boolean(state[key]);
  }
}

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
  ipcMain.handle("core:detectSystemTex", () => client.detectSystemTex());
  ipcMain.handle("core:listInstalledPackages", () => client.listInstalledPackages());
  ipcMain.handle("core:installPackage", (_event, name) => client.installPackage(name));
  ipcMain.handle("core:removePackage", (_event, name) => client.removePackage(name));
  ipcMain.handle("core:readFile", (_event, uri) => client.readFile(uri));
  ipcMain.handle("core:writeFile", (_event, uri, text) => client.writeFile(uri, text));

  ipcMain.handle("desktop:createScratchProject", () => createScratchProject());

  ipcMain.handle("desktop:chooseProjectFolder", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("desktop:createFile", async (_event, projectDir) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: path.join(projectDir, "untitled.tex"),
    });
    if (result.canceled || !result.filePath) return null;
    fs.writeFileSync(result.filePath, "");
    return result.filePath;
  });

  ipcMain.handle("desktop:chooseFile", async (_event, projectDir) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      defaultPath: projectDir,
      properties: ["openFile"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // Mirrors the same Save/Discard/Cancel choice TabBar.tsx's own inline confirmation already
  // offers when closing a dirty tab by click -- this is the same guard for the ⌘W/Close Folder
  // command paths, which don't go through that component at all.
  ipcMain.handle("desktop:confirmDiscard", async (_event, message) => {
    const result = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      buttons: ["Save", "Discard", "Cancel"],
      defaultId: 0,
      cancelId: 2,
      message,
    });
    return ["save", "discard", "cancel"][result.response];
  });

  ipcMain.handle("desktop:reportViewState", (_event, state) => updateViewMenuChecks(state));

  ipcMain.handle("desktop:readPdfFile", (_event, pdfPath) => new Uint8Array(fs.readFileSync(pdfPath)));

  // Task 4.7: writes a pasted image's raw bytes into <projectDir>/figures/, creating that
  // directory on first use. Returns the project-relative path so the renderer can insert it
  // straight into an \includegraphics call without knowing the absolute path.
  ipcMain.handle("desktop:pasteImage", (_event, projectDir, bytes, extension) => {
    const figuresDir = path.join(projectDir, "figures");
    fs.mkdirSync(figuresDir, { recursive: true });
    const filename = `pasted-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
    fs.writeFileSync(path.join(figuresDir, filename), Buffer.from(bytes));
    return `figures/${filename}`;
  });

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

  Menu.setApplicationMenu(buildMenu());
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
