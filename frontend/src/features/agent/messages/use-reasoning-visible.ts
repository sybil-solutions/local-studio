import { useCallback, useSyncExternalStore } from "react";
import { REASONING_VISIBILITY_CHANGED_EVENT } from "@/lib/workspace-events";
import { loadReasoningVisible } from "./reasoning-pref";

/** Reactively reads the global "show reasoning" preference. Re-renders the
 *  caller whenever the toggle changes (same tab via the custom event, other
 *  tabs via the native `storage` event). Server snapshot is `true` so SSR keeps
 *  reasoning visible by default. */
export function useReasoningVisible(): boolean {
  const subscribe = useCallback((notify: () => void): (() => void) => {
    window.addEventListener(REASONING_VISIBILITY_CHANGED_EVENT, notify);
    window.addEventListener("storage", notify);
    return () => {
      window.removeEventListener(REASONING_VISIBILITY_CHANGED_EVENT, notify);
      window.removeEventListener("storage", notify);
    };
  }, []);
  return useSyncExternalStore(subscribe, loadReasoningVisible, () => true);
}
