const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("quire", {
  compile: (source) => ipcRenderer.invoke("compile", source),
  openProject: () => ipcRenderer.invoke("openProject"),
  forwardSync: (line) => ipcRenderer.invoke("forwardSync", line),
  inverseSync: (page, x, y) => ipcRenderer.invoke("inverseSync", page, x, y),
});
