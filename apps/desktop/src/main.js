const { app, BrowserWindow, ipcMain, dialog, Menu } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { StdioTransport } = require("@quire/client");

const DEV_SERVER_URL = "http://localhost:5173";
const isMac = process.platform === "darwin";

// Duplicated literal, not imported, same reasoning as App.tsx's SIDECAR_CALL_CANCELLED comment; needs real body content since an empty document fails to compile.
const BLANK_PROJECT_SOURCE = "\\documentclass{article}\n\\begin{document}\nHello, world!\n\\end{document}\n";

// templates/*.tex, resolved relative to this dev checkout; a packaged build will need this path swapped for process.resourcesPath instead.
const TEMPLATES_DIR = path.join(__dirname, "..", "..", "..", "templates");
const TEMPLATE_IDS = ["article", "ieee", "acm", "beamer"];

let client;
let mainWindow;

// Every non-role menu item dispatches through this single channel by id, so a menu click, its accelerator, and the palette all run the same command.
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
        { label: "New Project…", accelerator: "CmdOrCtrl+Shift+N", click: () => sendMenuCommand("project.new") },
        { label: "Open File…", accelerator: "CmdOrCtrl+Shift+O", click: () => sendMenuCommand("file.open") },
        { label: "Open Folder…", accelerator: "CmdOrCtrl+O", click: () => sendMenuCommand("project.open") },
        { type: "separator" },
        { label: "Close File", accelerator: "CmdOrCtrl+W", click: () => sendMenuCommand("file.close") },
        { label: "Close All Files", accelerator: "CmdOrCtrl+Shift+W", click: () => sendMenuCommand("file.close-all") },
        { label: "Close Folder", click: () => sendMenuCommand("file.close-folder") },
        { type: "separator" },
        { label: "Save", accelerator: "CmdOrCtrl+S", click: () => sendMenuCommand("file.save") },
        { label: "Save As…", accelerator: "CmdOrCtrl+Shift+S", click: () => sendMenuCommand("file.save-as") },
        { type: "separator" },
        { label: "Export…", accelerator: "CmdOrCtrl+Shift+E", click: () => sendMenuCommand("file.export") },
        ...(isMac ? [] : [{ type: "separator" }, { role: "quit" }]),
      ],
    },
    {
      label: "Edit",
      submenu: [
        // Not `role: "undo"/"redo"` -- CM6 manages its own history, so the native role would be a silent no-op with focus in the editor.
        { label: "Undo", accelerator: "CmdOrCtrl+Z", click: () => sendMenuCommand("editor.undo") },
        { label: "Redo", accelerator: "Shift+CmdOrCtrl+Z", click: () => sendMenuCommand("editor.redo") },
        { type: "separator" },
        { label: "Find", accelerator: "CmdOrCtrl+F", click: () => sendMenuCommand("editor.find") },
        { label: "Find and Replace", accelerator: "CmdOrCtrl+Alt+F", click: () => sendMenuCommand("editor.find-replace") },
        { type: "separator" },
        // Cut/copy/paste/select-all DO work correctly via native roles -- CM6 integrates with browser clipboard events for these.
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
        { type: "separator" },
        { label: "Format Document", accelerator: "Shift+Alt+F", click: () => sendMenuCommand("editor.format-document") },
      ],
    },
    {
      label: "View",
      submenu: [
        // Parity with the command palette -- checkbox state is kept in sync by updateViewMenuChecks, since Electron menus don't reactively bind on their own.
        { id: "view.file-tree", label: "Show Explorer", type: "checkbox", accelerator: "CmdOrCtrl+1", click: () => sendMenuCommand("panel.file-tree") },
        { id: "view.search", label: "Show Search", type: "checkbox", accelerator: "CmdOrCtrl+Shift+F", click: () => sendMenuCommand("panel.search") },
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

// Keys match exactly what App.tsx's reportViewState effect sends -- deliberate duplication, no shared TS import possible here.
const VIEW_MENU_CHECK_IDS = {
  "file-tree": "view.file-tree",
  search: "view.search",
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
    // Matches --ink-900 (dark theme default) to avoid a white flash before first paint.
    backgroundColor: "#16181d",
    ...(isMac ? { titleBarStyle: "hidden", trafficLightPosition: { x: 12, y: 10 } } : {}),
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

// `templateId` is renderer-supplied IPC input, validated against TEMPLATE_IDS so a compromised renderer can't read arbitrary paths.
function scaffoldProject(dirPath, templateId) {
  // Dotfiles ignored -- a freshly created Finder folder already has a .DS_Store, not meaningfully "not empty".
  const visibleEntries = fs.readdirSync(dirPath).filter((name) => !name.startsWith("."));
  if (visibleEntries.length > 0) {
    throw new Error("That folder isn't empty. Choose a new or empty folder for a new project.");
  }
  let source;
  if (templateId === null) {
    source = BLANK_PROJECT_SOURCE;
  } else if (TEMPLATE_IDS.includes(templateId)) {
    source = fs.readFileSync(path.join(TEMPLATES_DIR, `${templateId}.tex`), "utf8");
  } else {
    throw new Error(`Unknown template: ${templateId}`);
  }
  fs.writeFileSync(path.join(dirPath, "main.tex"), source);
}

// `sourceFiles` paths come from a real openProject() response, already trusted, unlike scaffoldProject's templateId. `dirtyText` set means an open tab's live text is used instead of stale disk content.
async function exportProject({ projectDir, pdfPath, includeSource, sourceFiles }) {
  const projectName = path.basename(projectDir);
  const documentsDir = app.getPath("documents");

  if (!includeSource) {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: path.join(documentsDir, `${projectName}.pdf`),
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (result.canceled || !result.filePath) return null;
    fs.copyFileSync(pdfPath, result.filePath);
    return result.filePath;
  }

  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.join(documentsDir, `${projectName}.zip`),
    filters: [{ name: "Zip Archive", extensions: ["zip"] }],
  });
  if (result.canceled || !result.filePath) return null;

  // ESM-only package ("archiver" >=8 dropped its old CJS factory-function API) -- dynamic import from this CJS file.
  const { ZipArchive } = await import("archiver");

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(result.filePath);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    output.on("close", resolve);
    archive.on("error", reject);
    archive.pipe(output);

    archive.file(pdfPath, { name: `${projectName}.pdf` });
    // Source files sit under source/ so the PDF and the source tree can never collide on name.
    for (const { path: filePath, dirtyText } of sourceFiles ?? []) {
      const relative = path.join("source", path.relative(projectDir, filePath));
      if (dirtyText !== undefined) archive.append(dirtyText, { name: relative });
      else archive.file(filePath, { name: relative });
    }

    archive.finalize();
  });

  return result.filePath;
}

app.whenReady().then(() => {
  client = new StdioTransport();
  const sessionFile = path.join(app.getPath("userData"), "session.json");
  const themesFile = path.join(app.getPath("userData"), "themes.json");

  // On macOS the app can outlive the window past window-all-closed; isDestroyed() guards a late event.
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
  ipcMain.handle("core:searchProject", (_event, r) => client.searchProject(r));
  ipcMain.handle("core:replaceInProject", (_event, r) => client.replaceInProject(r));

  ipcMain.handle("desktop:chooseProjectFolder", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // "createDirectory" adds the native "New Folder" affordance, letting one dialog pick or create+name a folder.
  ipcMain.handle("desktop:chooseNewProjectFolder", async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory", "createDirectory"] });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("desktop:scaffoldProject", (_event, dirPath, templateId) => scaffoldProject(dirPath, templateId));

  ipcMain.handle("desktop:exportProject", (_event, options) => exportProject(options));

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

  // Mirrors TabBar.tsx's own Save/Discard/Cancel confirmation, for the ⌘W/Close Folder paths that don't go through that component.
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

  // Writes a pasted image's raw bytes into <projectDir>/figures/; returns the project-relative path for \includegraphics.
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

  // Renderer validates/normalizes each entry (see normalizeCustomThemes in theme.ts) -- this
  // layer just needs to not crash on a missing or corrupt file, same as loadSession above.
  ipcMain.handle("desktop:loadThemes", () => {
    try {
      const parsed = JSON.parse(fs.readFileSync(themesFile, "utf8"));
      return Array.isArray(parsed?.themes) ? parsed.themes : [];
    } catch {
      return [];
    }
  });

  ipcMain.handle("desktop:saveThemes", (_event, themes) => {
    fs.writeFileSync(themesFile, JSON.stringify({ version: 1, themes }));
  });

  // Single-theme JSON, not the whole themes.json shape -- lets a user share/receive one theme at
  // a time. `content` is written verbatim (renderer already serialized it); returns the raw text
  // on import, unvalidated -- renderer runs it through normalizeCustomThemes before use.
  ipcMain.handle("desktop:exportTheme", async (_event, defaultFileName, content) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: path.join(app.getPath("documents"), `${defaultFileName}.json`),
      filters: [{ name: "Quire Theme", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return null;
    fs.writeFileSync(result.filePath, content);
    return result.filePath;
  });

  ipcMain.handle("desktop:importTheme", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      filters: [{ name: "Quire Theme", extensions: ["json"] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    try {
      return fs.readFileSync(result.filePaths[0], "utf8");
    } catch {
      return null;
    }
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
