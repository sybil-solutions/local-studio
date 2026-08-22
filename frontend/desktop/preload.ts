import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { DesktopBridge } from "./interfaces";

const bridge: DesktopBridge = {
  getRuntime: () => ipcRenderer.invoke("desktop:get-runtime"),
  openExternal: (url) => ipcRenderer.invoke("desktop:open-external", url),
  revealPath: (target) => ipcRenderer.invoke("desktop:reveal-path", target),
  openPath: (target) => ipcRenderer.invoke("desktop:open-path", target),
  getUpdateStatus: () => ipcRenderer.invoke("desktop:get-update-status"),
  startUpdate: () => ipcRenderer.invoke("desktop:start-update"),
  openDirectory: () => ipcRenderer.invoke("desktop:open-directory"),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  listProjects: () => ipcRenderer.invoke("desktop:list-projects"),
  removeProject: (id) => ipcRenderer.invoke("desktop:remove-project", id),
  loadSessionPrefs: () => ipcRenderer.invoke("desktop:load-session-prefs"),
  saveSessionPrefs: (prefs) => ipcRenderer.invoke("desktop:save-session-prefs", prefs),
  loadUiPreferences: () => ipcRenderer.invoke("desktop:load-ui-preferences"),
  saveUiPreferences: (prefs) => ipcRenderer.invoke("desktop:save-ui-preferences", prefs),
  getKittylitterPairingJson: () => ipcRenderer.invoke("desktop:get-kittylitter-pairing-json"),
  copyKittylitterPairingJson: (pairingJson) =>
    ipcRenderer.invoke("desktop:copy-kittylitter-pairing-json", pairingJson),
  controllerDeploy: {
    start: (options) => ipcRenderer.invoke("desktop:controller-deploy", options),
    onLog: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: { line: string }) =>
        listener(payload.line);
      ipcRenderer.on("desktop:controller-deploy-log", handler);
      return () => ipcRenderer.removeListener("desktop:controller-deploy-log", handler);
    },
  },
};

contextBridge.exposeInMainWorld("localStudioDesktop", bridge);
