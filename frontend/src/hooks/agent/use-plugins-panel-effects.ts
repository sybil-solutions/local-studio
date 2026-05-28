// One-shot hook that fires the initial extensions listing fetch for the
// plugins panel. Workspace components delegate side-effect subscriptions to
// dedicated hooks so component files stay render-focused.

import { useCallback, useRef, useSyncExternalStore } from "react";

export function usePluginsPanelInitialLoadEffect(refresh: () => Promise<void>): void {
  const refreshRef = useRef(refresh);
  const subscribe = useCallback((_notify: () => void) => {
    void refreshRef.current();
    return () => {};
  }, []);

  useSyncExternalStore(subscribe, getPluginsPanelSnapshot, getPluginsPanelSnapshot);
}

/**
 * Debounced catalog fetch for the plugins panel. Re-runs whenever `query`
 * or `view` changes.
 */
export function usePluginsCatalogFetchEffect(params: {
  view: "browse" | "installed";
  query: string;
  onLoad: (loading: boolean) => void;
  onError: (error: string | null) => void;
  onResult: (entries: unknown) => void;
}): void {
  const { view, query, onLoad, onError, onResult } = params;
  const subscribe = useCallback(
    (_notify: () => void) => {
      if (view !== "browse") return () => {};
      const handle = setTimeout(async () => {
        onLoad(true);
        onError(null);
        try {
          const url = `/api/agent/extensions/catalog?q=${encodeURIComponent(query)}&size=60`;
          const response = await fetch(url, { cache: "no-store" });
          const payload = (await response.json()) as {
            entries?: unknown;
            error?: string;
          };
          if (!response.ok || payload.error) {
            throw new Error(payload.error ?? `HTTP ${response.status}`);
          }
          onResult(payload.entries);
        } catch (err) {
          onError(err instanceof Error ? err.message : "Failed to load catalog");
        } finally {
          onLoad(false);
        }
      }, 250);
      return () => clearTimeout(handle);
    },
    [query, view, onLoad, onError, onResult],
  );

  useSyncExternalStore(subscribe, getPluginsPanelSnapshot, getPluginsPanelSnapshot);
}

const getPluginsPanelSnapshot = (): number => 0;
