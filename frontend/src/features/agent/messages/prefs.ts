import { SESSION_PREFS_KEY } from "@/features/agent/workspace/store";
import { SESSION_PREFS_CHANGED_EVENT } from "@/lib/workspace-events";

export type SessionPref = {
  title?: string;
  pinned?: boolean;
  hidden?: boolean;
};

export type SessionPrefs = Record<string, SessionPref>;

function getDesktopBridge(): {
  loadSessionPrefs(): Promise<SessionPrefs>;
  saveSessionPrefs(prefs: SessionPrefs): Promise<void>;
} | null {
  if (typeof window === "undefined") return null;
  const bridge = (
    window as {
      localStudioDesktop?: {
        loadSessionPrefs?: () => Promise<SessionPrefs>;
        saveSessionPrefs?: (prefs: SessionPrefs) => Promise<void>;
      };
    }
  ).localStudioDesktop;
  if (!bridge?.loadSessionPrefs || !bridge?.saveSessionPrefs) return null;
  return bridge as {
    loadSessionPrefs(): Promise<SessionPrefs>;
    saveSessionPrefs(prefs: SessionPrefs): Promise<void>;
  };
}

/** Fast synchronous read from localStorage. Use this during renders. */
export function loadSessionPrefs(): SessionPrefs {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(SESSION_PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as SessionPrefs) : {};
  } catch {
    return {};
  }
}

/** One-time bootstrap: if localStorage is empty, restore from the durable
 *  desktop file (survives killall / crash). Call on app startup. */
export async function hydrateSessionPrefsFromDesktop(): Promise<void> {
  if (typeof window === "undefined") return;
  // Only hydrate if localStorage is empty — avoids overwriting newer data.
  if (window.localStorage.getItem(SESSION_PREFS_KEY)) return;
  try {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    const prefs = await bridge.loadSessionPrefs();
    if (prefs && typeof prefs === "object" && Object.keys(prefs).length > 0) {
      window.localStorage.setItem(SESSION_PREFS_KEY, JSON.stringify(prefs));
      window.dispatchEvent(new Event(SESSION_PREFS_CHANGED_EVENT));
    }
  } catch {
    /* ignore */
  }
}

export function saveSessionPrefs(prefs: SessionPrefs): void {
  if (typeof window === "undefined") return;
  // Primary: localStorage for fast access.
  window.localStorage.setItem(SESSION_PREFS_KEY, JSON.stringify(prefs));
  // Backup: durable file via Electron main process (survives killall / crash).
  try {
    const bridge = getDesktopBridge();
    if (bridge) void bridge.saveSessionPrefs(prefs).catch(() => {});
  } catch {
    /* ignore if not in Electron */
  }
  window.dispatchEvent(new Event(SESSION_PREFS_CHANGED_EVENT));
}

export function patchSessionPref(piSessionId: string, patch: SessionPref): void {
  const all = loadSessionPrefs();
  const current = all[piSessionId] ?? {};
  const next: SessionPref = { ...current, ...patch };
  // Drop the entry entirely once every flag is cleared so localStorage doesn't
  // grow without bound.
  if (!next.title && !next.pinned && !next.hidden) {
    delete all[piSessionId];
  } else {
    all[piSessionId] = next;
  }
  saveSessionPrefs(all);
}

export function copySessionPref(fromKey: string, toKey: string): void {
  if (!fromKey || !toKey || fromKey === toKey) return;
  const all = loadSessionPrefs();
  const source = all[fromKey];
  if (!source?.title && !source?.pinned && !source?.hidden) return;
  all[toKey] = { ...(all[toKey] ?? {}), ...source };
  saveSessionPrefs(all);
}
