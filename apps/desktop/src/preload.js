const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

// The real CoreApi (packages/client/src/CoreApi.ts), forwarded over IPC
// method-for-method -- packages/ui types `window.quire` against that same
// interface (see src/quire.d.ts), not a bespoke shape of its own. Replaces
// the old ad hoc compile(source)/openProject()/complete(text,line,ch)
// bridge task 2.3 removed.
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
  // Every CoreEvent (compile-started/-finished, files-changed, ...),
  // forwarded unchanged from `client.onEvent` in main.js. Returns an
  // unsubscribe function.
  onEvent: (handler) => {
    const listener = (_event, coreEvent) => handler(coreEvent);
    ipcRenderer.on("core-event", listener);
    return () => ipcRenderer.removeListener("core-event", listener);
  },
});

// Desktop-only capabilities that are NOT part of CoreApi and never will
// be -- see src/quire.d.ts for why each of these has to live outside the
// real contract (a native folder picker, reading compiled PDF *bytes*
// when CoreApi.readFile is text-only, and the scratch-project filesystem
// setup that predates any real project being opened).
contextBridge.exposeInMainWorld("quireDesktop", {
  createScratchProject: invoke("desktop:createScratchProject"),
  chooseProjectFolder: invoke("desktop:chooseProjectFolder"),
  readPdfFile: invoke("desktop:readPdfFile"),
});
