const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("quire", {
  compile: (source) => ipcRenderer.invoke("compile", source),
  openProject: () => ipcRenderer.invoke("openProject"),
  complete: (text, line, character) => ipcRenderer.invoke("complete", text, line, character),
  // Pushed by main.js when a file changes *outside* the app (task 1.3) --
  // there's no corresponding invoke() call driving this one, main starts
  // it unprompted. Returns an unsubscribe function.
  onExternalRecompile: (callback) => {
    const listener = (_event, result) => callback(result);
    ipcRenderer.on("externalRecompile", listener);
    return () => ipcRenderer.removeListener("externalRecompile", listener);
  },
});
