interface Window {
  localStudioDesktop?: {
    openExternal?(url: string): Promise<boolean>;
    revealPath?(target: string): Promise<boolean>;
    openPath?(target: string): Promise<boolean>;
    getRuntime?(): Promise<{
      appVersion: string;
      platform: string;
      packaged: boolean;
      releaseChannel: "dev" | "stable";
    }>;
    getUpdateStatus?(): Promise<{
      status: string;
      version?: string;
      message?: string;
      progress?: number;
    }>;
    startUpdate?(): Promise<{
      status: string;
      version?: string;
      message?: string;
      progress?: number;
    }>;
    getKittylitterPairingJson?(): Promise<import("../desktop/interfaces").KittylitterPairingResult>;
    copyKittylitterPairingJson?(pairingJson: string): Promise<{
      ok: boolean;
      error?: string;
    }>;
  };
}
