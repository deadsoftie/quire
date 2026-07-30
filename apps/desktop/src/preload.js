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
  readPdfFile: invoke("desktop:readPdfFile"),
  loadSession: invoke("desktop:loadSession"),
  saveSession: invoke("desktop:saveSession"),
});
