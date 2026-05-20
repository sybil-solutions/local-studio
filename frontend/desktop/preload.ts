import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { DesktopBridge } from "./interfaces";

const bridge: DesktopBridge = {
  getRuntime: () => ipcRenderer.invoke("desktop:get-runtime"),
  openExternal: (url) => ipcRenderer.invoke("desktop:open-external", url),
  getUpdateStatus: () => ipcRenderer.invoke("desktop:get-update-status"),
  checkForUpdates: () => ipcRenderer.invoke("desktop:check-for-updates"),
  openDirectory: () => ipcRenderer.invoke("desktop:open-directory"),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  listProjects: () => ipcRenderer.invoke("desktop:list-projects"),
  addProject: (directoryPath) => ipcRenderer.invoke("desktop:add-project", directoryPath),
  removeProject: (id) => ipcRenderer.invoke("desktop:remove-project", id),
  loadSessionPrefs: () => ipcRenderer.invoke("desktop:load-session-prefs"),
  saveSessionPrefs: (prefs) => ipcRenderer.invoke("desktop:save-session-prefs", prefs),
};

contextBridge.exposeInMainWorld("vllmStudioDesktop", bridge);
