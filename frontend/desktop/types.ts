export type DesktopAppState = "starting" | "ready" | "stopping";

export interface DesktopServerRuntime {
  port: number;
  url: string;
  mode: "dev-server" | "embedded-standalone";
}

export interface DesktopUpdateSnapshot {
  status:
    | "idle"
    | "checking"
    | "available"
    | "not-available"
    | "downloading"
    | "downloaded"
    | "error";
  version?: string;
  message?: string;
  progress?: number;
}
