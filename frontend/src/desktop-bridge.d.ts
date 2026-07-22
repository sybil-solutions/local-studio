interface Window {
  localStudioDesktop?: {
    openExternal?(url: string): Promise<boolean>;
    getKittylitterPairingJson?(): Promise<{
      ok: boolean;
      pairingJson?: string;
      error?: string;
    }>;
  };
}
