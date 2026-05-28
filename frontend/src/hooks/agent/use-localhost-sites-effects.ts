import { useCallback, useSyncExternalStore, type Dispatch, type SetStateAction } from "react";
import type { LocalhostSite } from "@/app/agent/_components/agent-browser";

type UseLocalhostSitesEffectsParams = {
  enabled: boolean;
  onLoadingChange: Dispatch<SetStateAction<boolean>>;
  onSitesChange: Dispatch<SetStateAction<LocalhostSite[]>>;
  onErrorChange: Dispatch<SetStateAction<string | null>>;
};

export function useLocalhostSitesEffects({
  enabled,
  onLoadingChange,
  onSitesChange,
  onErrorChange,
}: UseLocalhostSitesEffectsParams): void {
  const subscribe = useCallback(
    (notify: () => void) => {
      if (!enabled) return () => {};
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
          if (!cancelled) {
            onLoadingChange(false);
            notify();
          }
        });
      return () => {
        cancelled = true;
      };
    },
    [enabled, onErrorChange, onLoadingChange, onSitesChange],
  );

  useSyncExternalStore(subscribe, getLocalhostSitesSnapshot, getLocalhostSitesSnapshot);
}

const getLocalhostSitesSnapshot = (): number => 0;
