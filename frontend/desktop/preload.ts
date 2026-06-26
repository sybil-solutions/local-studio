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
  loadUiPreferences: () => ipcRenderer.invoke("desktop:load-ui-preferences"),
  saveUiPreferences: (prefs) => ipcRenderer.invoke("desktop:save-ui-preferences", prefs),
  terminal: {
    status: () => ipcRenderer.invoke("desktop:pty-status"),
    open: (opts) => ipcRenderer.invoke("desktop:pty-open", opts),
    write: (id, data) => ipcRenderer.invoke("desktop:pty-write", id, data),
    resize: (id, cols, rows) => ipcRenderer.invoke("desktop:pty-resize", id, cols, rows),
    close: (id) => ipcRenderer.invoke("desktop:pty-close", id),
    closeOwner: (ownerKey) => ipcRenderer.invoke("desktop:pty-close-owner", ownerKey),
    onData: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: { id: string; chunk: string }) =>
        listener(payload.id, payload.chunk);
      ipcRenderer.on("desktop:pty-data", handler);
      return () => ipcRenderer.removeListener("desktop:pty-data", handler);
    },
    onExit: (listener) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        payload: { id: string; exitCode: number; signal: number | null },
      ) => listener(payload.id, { exitCode: payload.exitCode, signal: payload.signal });
      ipcRenderer.on("desktop:pty-exit", handler);
      return () => ipcRenderer.removeListener("desktop:pty-exit", handler);
    },
  },
};

contextBridge.exposeInMainWorld("localStudioDesktop", bridge);
