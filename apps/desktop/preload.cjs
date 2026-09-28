const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("localStudio", { pickFolder: () => ipcRenderer.invoke("pick-folder") });
