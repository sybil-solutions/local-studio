import { isAgentThinkingLevel, type AgentThinkingLevel } from "@/features/agent/contracts";

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
