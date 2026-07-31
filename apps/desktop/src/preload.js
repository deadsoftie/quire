const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld("quire", {
  openProject: invoke("core:openProject"),
  setRoot: invoke("core:setRoot"),
  closeProject: invoke("core:closeProject"),
  compile: invoke("core:compile"),
  cancelCompile: invoke("core:cancelCompile"),
  complete: invoke("core:complete"),
  outline: invoke("core:outline"),
  prefetchPackages: invoke("core:prefetchPackages"),
  bundleStatus: invoke("core:bundleStatus"),
  detectSystemTex: invoke("core:detectSystemTex"),
  listInstalledPackages: invoke("core:listInstalledPackages"),
  installPackage: invoke("core:installPackage"),
  removePackage: invoke("core:removePackage"),
  readFile: invoke("core:readFile"),
  writeFile: invoke("core:writeFile"),
  // Returns an unsubscribe function.
  onEvent: (handler) => {
    const listener = (_event, coreEvent) => handler(coreEvent);
    ipcRenderer.on("core-event", listener);
    return () => ipcRenderer.removeListener("core-event", listener);
  },
});

contextBridge.exposeInMainWorld("quireDesktop", {
  createScratchProject: invoke("desktop:createScratchProject"),
  chooseProjectFolder: invoke("desktop:chooseProjectFolder"),
  createFile: invoke("desktop:createFile"),
  chooseFile: invoke("desktop:chooseFile"),
  confirmDiscard: invoke("desktop:confirmDiscard"),
  reportViewState: invoke("desktop:reportViewState"),
  readPdfFile: invoke("desktop:readPdfFile"),
  pasteImage: invoke("desktop:pasteImage"),
  loadSession: invoke("desktop:loadSession"),
  saveSession: invoke("desktop:saveSession"),
  // Returns an unsubscribe function.
  onMenuCommand: (handler) => {
    const listener = (_event, id) => handler(id);
    ipcRenderer.on("menu:command", listener);
    return () => ipcRenderer.removeListener("menu:command", listener);
  },
});
