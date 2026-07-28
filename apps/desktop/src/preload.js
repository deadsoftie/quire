const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("quire", {
  compile: (source) => ipcRenderer.invoke("compile", source),
});
