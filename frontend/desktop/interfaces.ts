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
  ownerKey?: string;
}

export interface PtyBridge {
  status(): Promise<PtyStatus>;
  open(opts: PtyOpenOpts): Promise<{ id: string; replay?: string; reused?: boolean }>;
  write(id: string, data: string): Promise<void>;
  resize(id: string, cols: number, rows: number): Promise<void>;
  close(id: string): Promise<void>;
  closeOwner(ownerKey: string): Promise<void>;
  onData(listener: (id: string, chunk: string) => void): () => void;
  onExit(
    listener: (id: string, info: { exitCode: number; signal: number | null }) => void,
  ): () => void;
}

export interface QuickPanelHotkeyState {
  hotkey: string;
  defaultHotkey: string;
}

export interface QuickPanelHotkeyResult {
  ok: boolean;
  hotkey: string;
  error?: string;
}

export interface QuickPanelBridge {
  expand(): Promise<void>;
  dismiss(): Promise<void>;
  focusMainAndNavigate(projectId: string, sessionId?: string): Promise<void>;
  getHotkey(): Promise<QuickPanelHotkeyState>;
  setHotkey(hotkey: string): Promise<QuickPanelHotkeyResult>;
}

export interface ControllerDeployResultPayload {
  ok: boolean;
  url?: string;
  apiKey?: string;
  error?: string;
}

export interface ControllerDeployBridge {
  /** Deploy a controller to an ssh host; resolves with url + api key. */
  start(options: {
    host: string;
    port?: number;
    installDir?: string;
  }): Promise<ControllerDeployResultPayload>;
  /** Streamed installer output lines for the in-flight deploy. */
  onLog(listener: (line: string) => void): () => void;
}

export interface ConnectorApprovalsBridge {
  list(): Promise<unknown>;
  decide(requestId: string, decision: "approve" | "deny"): Promise<void>;
}

export interface ConnectorManagementBridge {
  list(): Promise<unknown>;
  save(payload: string): Promise<unknown>;
  remove(id: string): Promise<unknown>;
  probe(id: string): Promise<string>;
}

export interface PluginManagementBridge {
  list(): Promise<string>;
  setEnabled(id: string, enabled: boolean): Promise<string>;
}

export type GoogleAccountId = "gmail" | "google-calendar";

export interface GoogleAccountManagementBridge {
  get(): Promise<string>;
  saveClient(payload: string): Promise<string>;
  disconnect(account: GoogleAccountId): Promise<string>;
  beginAuthorization(account: GoogleAccountId): Promise<string>;
  cancelAuthorization(account: GoogleAccountId): Promise<string>;
}

export interface DesktopBridge {
  getRuntime(): Promise<{
    platform: NodeJS.Platform;
    appVersion: string;
    chromeVersion: string;
    electronVersion: string;
    mode?: "dev-server" | "embedded-standalone";
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
  quickPanel: QuickPanelBridge;
  controllerDeploy: ControllerDeployBridge;
  connectorApprovals: ConnectorApprovalsBridge;
  connectors: ConnectorManagementBridge;
  plugins: PluginManagementBridge;
  googleAccount: GoogleAccountManagementBridge;
}
