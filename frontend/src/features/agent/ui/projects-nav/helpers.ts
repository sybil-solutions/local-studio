import type { DragEvent } from "react";
import { safeJson } from "@/features/agent/safe-json";
import { cleanSessionTitle } from "@/features/agent/messages/helpers";
import {
  patchSessionPref,
  type SessionPref,
  type SessionPrefs,
} from "@/features/agent/messages/prefs";
import { ADD_PROJECT_EVENT, SESSIONS_CHANGED_EVENT } from "@/lib/workspace-events";
import type { Project as ProjectEntry } from "@/features/agent/projects/types";
import type { ActiveAgentSession, SessionSummary } from "./types";

const SESSION_NAV_TITLE_PREFIX = "local-studio.agent.sessionNavTitle:";

export function setAgentSessionDragData(
  event: DragEvent,
  session: {
    piSessionId?: string | null;
    projectId?: string;
    cwd?: string;
    paneId?: string;
    tabId?: string;
    title?: string;
  },
) {
  if (session.piSessionId) {
    event.dataTransfer.setData("application/x-vllm-session", session.piSessionId);
  }
  event.dataTransfer.setData("application/x-vllm-agent-session", JSON.stringify(session));
  event.dataTransfer.effectAllowed = "copy";
}

function activeSessionPrefKeys(
  session: Pick<ActiveAgentSession, "piSessionId" | "paneId" | "tabId">,
): string[] {
  return [
    session.piSessionId,
    session.paneId && session.tabId ? `tab:${session.paneId}:${session.tabId}` : null,
  ].filter((value): value is string => Boolean(value));
}

export function mergeActiveSessionPref(
  session: Pick<ActiveAgentSession, "piSessionId" | "paneId" | "tabId">,
  prefs: SessionPrefs,
): SessionPref {
  const merged: SessionPref = {};
  for (const key of activeSessionPrefKeys(session)) {
    const pref = prefs[key];
    if (!pref) continue;
    if (pref.title) merged.title = pref.title;
    if (pref.pinned) merged.pinned = true;
    if (pref.hidden) merged.hidden = true;
  }
  return merged;
}

export function activeSessionPref(session: ActiveAgentSession, prefs: SessionPrefs): SessionPref {
  return mergeActiveSessionPref(session, prefs);
}

export function patchActiveSessionPref(session: ActiveAgentSession, patch: SessionPref) {
  for (const key of activeSessionPrefKeys(session)) patchSessionPref(key, patch);
}

export function relativeAge(value?: string | null): string {
  const timestamp = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(timestamp)) return "";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w`;
}

export function sessionDedupeKey(session: SessionSummary): string {
  const label = (session.firstUserMessage || "Untitled session")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return `${label}:${relativeAge(session.startedAt)}`;
}

export function triggerAddProjectFlow() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(ADD_PROJECT_EVENT));
}

/**
 * Append a short, monotonic `open=` nonce so a repeat click on the *same*
 * session still produces a distinct href (Next would otherwise dedupe the URL).
 */
export function hrefWithOpenNonce(href: string): string {
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}open=${Date.now().toString(36)}`;
}

/**
 * Open a session by href. Next 16's App Router silently no-ops a `router.push`
 * to the same `/agent` route when only the `session`/`open` searchParams change
 * — so clicking a session in the sidebar did nothing (the conversation never
 * loaded, and a running session looked like it reset). We try the soft push
 * first (instant where it works), then verify the URL actually moved to the
 * target session and fall back to a real navigation if it didn't. The hard nav
 * reliably loads the session — and reattaches a live in-flight turn via the
 * reload path.
 */
export function navigateToSessionHref(
  router: { push: (href: string) => void },
  href: string,
): void {
  router.push(href);
  if (typeof window === "undefined") return;
  const want = new URLSearchParams(href.split("?")[1] ?? "").get("session");
  if (!want) return;
  window.setTimeout(() => {
    const have = new URLSearchParams(window.location.search).get("session");
    if (have !== want) window.location.assign(href);
  }, 70);
}

export function rememberAgentSessionNavTitle(sessionId: string | null | undefined, title: string) {
  if (typeof window === "undefined" || !sessionId) return;
  const trimmed = cleanSessionTitle(title);
  if (!trimmed || trimmed === "Loading session") return;
  try {
    window.sessionStorage.setItem(`${SESSION_NAV_TITLE_PREFIX}${sessionId}`, trimmed);
  } catch {
    return;
  }
}

export function consumeAgentSessionNavTitle(sessionId: string | null | undefined) {
  if (typeof window === "undefined" || !sessionId) return undefined;
  const key = `${SESSION_NAV_TITLE_PREFIX}${sessionId}`;
  try {
    const title = cleanSessionTitle(window.sessionStorage.getItem(key)) || undefined;
    window.sessionStorage.removeItem(key);
    return title;
  } catch {
    return undefined;
  }
}

export async function setSessionArchive(
  sessionId: string,
  project: ProjectEntry,
  title: string,
  archived: boolean,
): Promise<void> {
  const response = await fetch(`/api/agent/sessions/${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      cwd: project.path,
      archived,
      projectId: project.id,
      projectName: project.name,
      title,
    }),
  });
  const payload = await safeJson<{ error?: string }>(response);
  if (!response.ok) {
    throw new Error(payload.error || "Failed to update session archive");
  }
  window.dispatchEvent(new Event(SESSIONS_CHANGED_EVENT));
}
