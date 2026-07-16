import type { DragEvent } from "react";
import { safeJson } from "@/features/agent/safe-json";
import { cleanSessionTitle } from "@/features/agent/messages/helpers";
import {
  patchCanonicalSessionPref,
  type SessionPref,
  type SessionPrefs,
} from "@/features/agent/messages/prefs";
import { ADD_PROJECT_EVENT, SESSIONS_CHANGED_EVENT } from "@/lib/workspace-events";
import type { Project as ProjectEntry } from "@/features/agent/projects/types";
import type { ActiveAgentSession } from "./types";

const SESSION_NAV_TITLE_PREFIX = "local-studio.agent.sessionNavTitle:";
let lastNavigationTimestamp = 0;
let navigationSequence = 0;

function nextNavigationIntent(): string {
  const timestamp = Date.now();
  navigationSequence = timestamp === lastNavigationTimestamp ? navigationSequence + 1 : 0;
  lastNavigationTimestamp = timestamp;
  return `${timestamp.toString(36)}.${navigationSequence.toString(36)}`;
}

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

function activeSessionPrefKeys(session: Pick<ActiveAgentSession, "threadId" | "id">): string[] {
  return [session.id, session.threadId].filter((value): value is string => Boolean(value));
}

function activeSessionPrimaryPrefKey(session: ActiveAgentSession): string {
  return session.threadId ?? `tab:${session.paneId}:${session.id}`;
}

export function mergeActiveSessionPref(
  session: Pick<ActiveAgentSession, "threadId" | "id">,
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

export function patchActiveSessionPref(session: ActiveAgentSession, patch: SessionPref) {
  const primary = activeSessionPrimaryPrefKey(session);
  const aliases = [...activeSessionPrefKeys(session), `tab:${session.paneId}:${session.id}`];
  patchCanonicalSessionPref(primary, aliases, patch);
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

export function triggerAddProjectFlow() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(ADD_PROJECT_EVENT));
}

export function hrefWithOpenNonce(href: string): string {
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}open=${nextNavigationIntent()}`;
}

export function navigateToSessionHref(
  router: { push: (href: string) => void },
  href: string,
): void {
  router.push(href);
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
