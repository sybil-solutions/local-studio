import type { DesktopUpdateSnapshot } from "./types";

export interface ProjectEntry {
  id: string;
  name: string;
  path: string;
  addedAt: string;
  exists: boolean;
  hasGit: boolean;
  branch: string | null;
}

export type SessionPrefsPayload = Record<
  string,
  { title?: string; pinned?: boolean; hidden?: boolean }
>;

export type UiPreferencesPayload = Record<string, string>;

export interface PtyStatus {
  available: boolean;
  reason: string | null;
}

export interface PtyOpenOpts {
  cwd?: string;
  cols?: number;
  rows?: number;
}

export interface PtyBridge {
  status(): Promise<PtyStatus>;
  open(opts: PtyOpenOpts): Promise<{ id: string }>;
  write(id: string, data: string): Promise<void>;
  resize(id: string, cols: number, rows: number): Promise<void>;
  close(id: string): Promise<void>;
  onData(listener: (id: string, chunk: string) => void): () => void;
  onExit(
    listener: (id: string, info: { exitCode: number; signal: number | null }) => void,
  ): () => void;
}

export interface DesktopBridge {
  getRuntime(): Promise<{
    platform: NodeJS.Platform;
    appVersion: string;
    chromeVersion: string;
    electronVersion: string;
  }>;
  openExternal(url: string): Promise<boolean>;
  getUpdateStatus(): Promise<DesktopUpdateSnapshot>;
  checkForUpdates(): Promise<DesktopUpdateSnapshot>;
  openDirectory(): Promise<ProjectEntry | null>;
  getPathForFile(file: File): string;
  listProjects(): Promise<ProjectEntry[]>;
  addProject(directoryPath: string): Promise<ProjectEntry>;
  removeProject(id: string): Promise<{ ok: true }>;
  /** Durable file-backed session prefs that survive process kill. */
  loadSessionPrefs(): Promise<SessionPrefsPayload>;
  saveSessionPrefs(prefs: SessionPrefsPayload): Promise<void>;
  /** Durable backup for renderer localStorage UI prefs (theme, font, layout). */
  loadUiPreferences(): Promise<UiPreferencesPayload>;
  saveUiPreferences(prefs: UiPreferencesPayload): Promise<void>;
  terminal: PtyBridge;
}

export interface IpcRequestMap {
  "desktop:get-runtime": () => Awaited<ReturnType<DesktopBridge["getRuntime"]>>;
  "desktop:open-external": (url: string) => Awaited<ReturnType<DesktopBridge["openExternal"]>>;
  "desktop:get-update-status": () => Awaited<ReturnType<DesktopBridge["getUpdateStatus"]>>;
  "desktop:check-for-updates": () => Awaited<ReturnType<DesktopBridge["checkForUpdates"]>>;
  "desktop:open-directory": () => Awaited<ReturnType<DesktopBridge["openDirectory"]>>;
  "desktop:list-projects": () => Awaited<ReturnType<DesktopBridge["listProjects"]>>;
  "desktop:add-project": (
    directoryPath: string,
  ) => Awaited<ReturnType<DesktopBridge["addProject"]>>;
  "desktop:remove-project": (id: string) => Awaited<ReturnType<DesktopBridge["removeProject"]>>;
}
