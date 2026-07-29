const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

// The real CoreApi (packages/client/src/CoreApi.ts), forwarded method-for-method; packages/ui types window.quire against that same interface (see src/quire.d.ts).
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
  // Every CoreEvent, forwarded from main.js. Returns an unsubscribe function.
  onEvent: (handler) => {
    const listener = (_event, coreEvent) => handler(coreEvent);
    ipcRenderer.on("core-event", listener);
    return () => ipcRenderer.removeListener("core-event", listener);
  },
});

// Desktop-only capabilities that are not part of CoreApi -- see src/quire.d.ts.
contextBridge.exposeInMainWorld("quireDesktop", {
  createScratchProject: invoke("desktop:createScratchProject"),
  chooseProjectFolder: invoke("desktop:chooseProjectFolder"),
  readPdfFile: invoke("desktop:readPdfFile"),
});
