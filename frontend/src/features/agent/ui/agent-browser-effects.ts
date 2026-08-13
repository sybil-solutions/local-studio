import { useMountSubscription } from "@/hooks/use-mount-subscription";

export type LocalhostSite = {
  port: number;
  url: string;
  displayUrl: string;
  title: string;
  process?: string;
  current?: boolean;
};

type UseLocalhostSitesEffectsParams = {
  enabled: boolean;
  onLoadingChange: (loading: boolean) => void;
  onSitesChange: (sites: LocalhostSite[]) => void;
  onErrorChange: (error: string | null) => void;
};

export function useLocalhostSitesEffects({
  enabled,
  onLoadingChange,
  onSitesChange,
  onErrorChange,
}: UseLocalhostSitesEffectsParams): void {
  useMountSubscription(() => {
    if (!enabled) return;
    let cancelled = false;
    onLoadingChange(true);
    onErrorChange(null);
    void fetch("/api/agent/browser/localhosts", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as { sites?: LocalhostSite[]; error?: string };
        if (!response.ok || payload.error) throw new Error(payload.error || "Failed to scan");
        if (!cancelled) onSitesChange(payload.sites ?? []);
      })
      .catch((error) => {
        if (!cancelled) {
          onSitesChange([]);
          onErrorChange(error instanceof Error ? error.message : "Failed to scan localhost");
        }
      })
      .finally(() => {
        if (!cancelled) onLoadingChange(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, onErrorChange, onLoadingChange, onSitesChange]);
}

type UseAgentBrowserEffectsParams = {
  url: string;
  readingMode: boolean;
  fetchReadable: (target: string) => Promise<void>;
  enabled?: boolean;
};

export function useAgentBrowserEffects({
  url,
  readingMode,
  fetchReadable,
  enabled = true,
}: UseAgentBrowserEffectsParams): void {
  useMountSubscription(() => {
    if (enabled && url && readingMode) {
      void fetchReadable(url);
    }
  }, [enabled, fetchReadable, readingMode, url]);
}

const LIVE_STATE_POLL_MS = 2_000;

export function useBrowserLiveStateSync({
  enabled,
  onLiveUrl,
}: {
  enabled: boolean;
  onLiveUrl: (url: string) => void;
}): void {
  useMountSubscription(() => {
    if (!enabled) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch("/api/agent/browser/state", { cache: "no-store" });
        const payload = (await response.json()) as { ok?: boolean; data?: { url?: string } };
        const liveUrl = payload.ok ? (payload.data?.url ?? "") : "";
        if (!cancelled && liveUrl && liveUrl !== "about:blank") onLiveUrl(liveUrl);
      } catch {
        return;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), LIVE_STATE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled, onLiveUrl]);
}
