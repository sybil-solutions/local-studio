import { useCallback, useSyncExternalStore } from "react";

export function useGitDiffPanelEffects(load: () => Promise<void>): void {
  const subscribe = useCallback(
    (notify: () => void) => {
      void load().finally(notify);
      return () => {};
    },
    [load],
  );

  useSyncExternalStore(subscribe, getGitDiffPanelSnapshot, getGitDiffPanelSnapshot);
}

const getGitDiffPanelSnapshot = (): number => 0;
