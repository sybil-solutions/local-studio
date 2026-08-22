import { SESSION_PREFS_KEY } from "@/features/agent/workspace/store";
import { REASONING_VISIBILITY_CHANGED_EVENT, SESSION_PREFS_CHANGED_EVENT } from "@/lib/workspace-events";
import { isAgentThinkingLevel, type AgentThinkingLevel } from "@/features/agent/contracts";
import { useCallback, useSyncExternalStore } from "react";

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
  patchCanonicalSessionPref(piSessionId, [], patch);
}

function hasSessionPref(pref: SessionPref): boolean {
  return Boolean(pref.title || pref.pinned || pref.hidden);
}

export function patchCanonicalSessionPref(
  primaryKey: string,
  aliasKeys: readonly string[],
  patch: SessionPref = {},
): void {
  if (!primaryKey) return;
  const all = loadSessionPrefs();
  const aliases = [...new Set(aliasKeys.filter((key) => key && key !== primaryKey))];
  if (Object.keys(patch).length === 0 && !aliases.some((key) => hasSessionPref(all[key] ?? {}))) {
    return;
  }
  let current: SessionPref = {};
  for (const key of aliases) current = { ...current, ...(all[key] ?? {}) };
  current = { ...current, ...(all[primaryKey] ?? {}) };
  const next: SessionPref = { ...current, ...patch };
  for (const key of aliases) delete all[key];
  if (hasSessionPref(next)) all[primaryKey] = next;
  else delete all[primaryKey];
  saveSessionPrefs(all);
}

export function isLocalSessionPrefKey(key: string): boolean {
  return key.startsWith("tab:") || key.startsWith("tab-");
}

// Global, client-only preference for whether model reasoning ("Thinking"/
// "Thought") is shown in the timeline. Stored in localStorage so it survives
// reloads without touching the (separately-owned) settings service. Default is
// visible — reasoning streams unless the user explicitly hides it.
const REASONING_VISIBLE_KEY = "local-studio.agent.reasoningVisible";

/** Synchronous localStorage read — safe to call during render. Defaults to
 *  `true` when unset, off the server, or if storage is unavailable. */
export function loadReasoningVisible(): boolean {
  if (typeof window === "undefined") return true;
  try {
    // Only the explicit "0" sentinel hides reasoning; anything else stays on.
    return window.localStorage.getItem(REASONING_VISIBLE_KEY) !== "0";
  } catch {
    return true;
  }
}

/** Persist the preference and notify open panes so they re-render at once. */
export function setReasoningVisible(visible: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(REASONING_VISIBLE_KEY, visible ? "1" : "0");
  } catch {
    /* ignore storage failures — the dispatch below still updates live state */
  }
  window.dispatchEvent(new Event(REASONING_VISIBILITY_CHANGED_EVENT));
}

// Global, client-only preference for the reasoning ("thinking") level a *new*
// session should start at. Persisted in localStorage so the last level the user
// picked seeds the next fresh session, instead of every new chat snapping back
// to the hard-coded "high" fallback. Per-session choices still live on the
// session tab (see pickThinkingLevel); this only supplies the default when a
// session has no saved level of its own.
const THINKING_LEVEL_DEFAULT_KEY = "local-studio.agent.thinkingLevelDefault";

/** Synchronous localStorage read — safe to call during render. Returns
 *  undefined when unset, off the server, or if storage is unavailable or holds
 *  a value that is no longer a valid level. */
export function loadThinkingLevelDefault(): AgentThinkingLevel | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(THINKING_LEVEL_DEFAULT_KEY);
    return isAgentThinkingLevel(raw) ? raw : undefined;
  } catch {
    return undefined;
  }
}

/** Remember the level the user just picked so the next fresh session adopts it.
 *  Best-effort — storage failures are swallowed like every other client pref. */
export function setThinkingLevelDefault(level: AgentThinkingLevel): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(THINKING_LEVEL_DEFAULT_KEY, level);
  } catch {
    /* ignore storage failures — persistence here is a convenience, not load-bearing */
  }
}

/** Resolve the level a session should use: its own saved choice wins, otherwise
 *  fall back to the user's remembered default, then "high", then whatever the
 *  model supports. Pure so it can be unit-tested without a DOM. */
export function pickThinkingLevel(
  levels: readonly AgentThinkingLevel[],
  saved: AgentThinkingLevel | undefined,
  preferred: AgentThinkingLevel | undefined,
): AgentThinkingLevel {
  if (saved && levels.includes(saved)) return saved;
  if (preferred && levels.includes(preferred)) return preferred;
  if (levels.includes("high")) return "high";
  return levels.at(-1) ?? "off";
}

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
