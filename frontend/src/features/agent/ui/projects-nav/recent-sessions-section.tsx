"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { cleanSessionTitle } from "@/features/agent/messages/helpers";
import {
  getSessionActivity,
  sessionActivity,
  subscribeSessionActivity,
  useOpenSessions,
  useSessionActivity,
} from "@/features/agent/session-index";
import { SessionStatusMark } from "@/features/agent/ui/projects-nav/nav-chrome";
import { orderByRecency, recentsTimestamp } from "@/features/agent/ui/session-recency";
import { useProjectsNavSessionPrefs } from "@/features/agent/ui/projects-nav/use-projects-nav-effects";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { Folder } from "@/ui/icons";
import type { SessionPrefs } from "@/features/agent/messages/session-prefs";
import type { AggregatedSession } from "@shared/agent/session-summary";

/** The nav lists the 20 most recently prompted sessions, newest first. */
const RECENT_LIMIT = 20;
/** Enough of the last prompt to recognise the thread without wrapping past two
 *  lines at the widest sidebar setting. */
const PREVIEW_CHARS = 120;

function sameActiveSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((id) => right.has(id));
}

/** Day buckets, the way the reference nav groups them: today and yesterday by
 *  name, the rest of the week by weekday, older rows by date. */
function dayLabel(iso: string): string {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return "Earlier";
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const dayMs = 86_400_000;
  const daysAgo = Math.floor((startOfToday.getTime() - ts) / dayMs) + 1;
  if (ts >= startOfToday.getTime()) return "Today";
  if (daysAgo <= 1) return "Yesterday";
  const date = new Date(ts);
  if (daysAgo < 7) return date.toLocaleDateString(undefined, { weekday: "long" });
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function rowTitle(session: AggregatedSession, prefs: SessionPrefs): string {
  return (
    cleanSessionTitle(prefs[session.id]?.title) ||
    cleanSessionTitle(session.firstUserMessage) ||
    `Session ${session.id.slice(0, 8)}`
  );
}

/** The last prompt, trimmed to a preview. Returns "" when the prompt is the
 *  same text the title already shows, so the row does not say it twice. */
function rowPreview(session: AggregatedSession, title: string): string {
  const prompt = cleanSessionTitle(session.lastUserPromptText ?? "");
  if (!prompt || prompt === title) return "";
  return prompt.length > PREVIEW_CHARS ? `${prompt.slice(0, PREVIEW_CHARS).trimEnd()}…` : prompt;
}

export function RecentSessionsSection() {
  const [sessions, setSessions] = useState<AggregatedSession[] | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const prefs = useProjectsNavSessionPrefs();

  useMountSubscription(() => {
    let cancelled = false;
    void import("@/features/agent/ui/sessions-command-effects")
      .then((mod) => mod.loadAggregatedSessions())
      .then((next) => {
        if (!cancelled) setSessions(next);
      })
      .catch(() => {
        if (!cancelled) setSessions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadNonce]);

  // A run starting or ending is what changes the ordering, and the session list
  // is a one-shot fetch — refetch when the active set moves.
  useMountSubscription(() => {
    let previous = getSessionActivity().active;
    return subscribeSessionActivity(() => {
      const next = getSessionActivity().active;
      const unchanged = sameActiveSet(previous, next);
      previous = next;
      if (unchanged) return;
      setReloadNonce((nonce) => nonce + 1);
    });
  }, []);

  const groups = useMemo(() => {
    const visible = (sessions ?? []).filter(
      (session) => !session.archived && !session.parentSessionId && !prefs[session.id]?.hidden,
    );
    const ordered = orderByRecency(visible).slice(0, RECENT_LIMIT);
    const buckets: { label: string; sessions: AggregatedSession[] }[] = [];
    for (const session of ordered) {
      const label = dayLabel(recentsTimestamp(session));
      const tail = buckets.at(-1);
      if (tail?.label === label) tail.sessions.push(session);
      else buckets.push({ label, sessions: [session] });
    }
    return buckets;
  }, [sessions, prefs]);

  if (sessions === null) {
    return <div className="px-2 py-1 text-[length:var(--fs-sm)] text-(--dim)">Loading…</div>;
  }
  if (groups.length === 0) {
    return <div className="px-2 py-1 text-[length:var(--fs-sm)] text-(--dim)">No recent chats</div>;
  }

  return (
    <div className="flex flex-col">
      {groups.map((group) => (
        <div key={group.label} className="flex flex-col">
          <div className="px-2 pb-1 pt-5 text-[length:var(--fs-md)] font-medium text-(--hl2) opacity-75">
            {group.label}
          </div>
          {group.sessions.map((session) => (
            <RecentSessionRow key={session.id} session={session} prefs={prefs} />
          ))}
        </div>
      ))}
    </div>
  );
}

function RecentSessionRow({ session, prefs }: { session: AggregatedSession; prefs: SessionPrefs }) {
  const activitySnapshot = useSessionActivity();
  const openSessions = useOpenSessions();
  const activity = sessionActivity([session.id], activitySnapshot);
  // The open thread reads as selected here the same way it does in the
  // project tree — this list is a navigation surface, so "where am I"
  // must be answerable at a glance.
  const isOpen = openSessions.some(
    (open) => open.focused && (open.threadId === session.id || open.id === session.id),
  );
  const title = rowTitle(session, prefs);
  const preview = rowPreview(session, title);
  return (
    <Link
      href={`/agent?project=${encodeURIComponent(session.projectId)}&session=${encodeURIComponent(session.id)}&replace=1`}
      title={[title, session.projectName, session.projectPath].filter(Boolean).join(" · ")}
      aria-current={isOpen ? "page" : undefined}
      // Two lines, not the single-line row the other sections use: the prompt
      // preview is the point of this list, so it gets its own line under the
      // title rather than competing with it for width.
      className={`group flex flex-col gap-0.5 rounded-[var(--sidebar-row-radius)] px-2 py-1.5 transition-colors hover:bg-(--hover) ${
        isOpen ? "bg-(--hover)" : ""
      }`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate text-[length:var(--fs-md)] text-(--fg)">{title}</span>
        {/* The same status marks the project tree uses — a session you are being
            notified about is exactly the one whose state you want to read. */}
        <SessionStatusMark
          activity={activity}
          runningClass="ml-auto flex shrink-0 justify-end"
          dotClass="ml-auto h-1.5 w-1.5 shrink-0 rounded-full"
        />
      </span>
      {preview ? (
        <span className="line-clamp-2 text-[length:var(--fs-sm)] leading-snug text-(--dim)">
          {preview}
        </span>
      ) : (
        <span className="flex min-w-0 items-center gap-1 text-[length:var(--fs-sm)] text-(--dim)">
          <Folder className="h-3 w-3 shrink-0" />
          <span className="truncate">{session.projectName}</span>
        </span>
      )}
    </Link>
  );
}
