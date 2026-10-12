"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type MouseEvent } from "react";
import { MenuItem } from "@/ui";
import { POPOVER_MENU_CLASS } from "@/ui/popover";
import {
  Archive,
  ChevronDownIcon,
  MoreIcon,
  PinIcon,
  PinOffIcon,
  SquarePen,
} from "@/ui/icon-registry";
import { cleanSessionTitle } from "@/features/agent/messages/helpers";
import { patchSessionPref, type SessionPrefs } from "@/features/agent/messages/prefs";
import { useProjects } from "@/features/agent/projects/context";
import { isChatsProject } from "@/features/agent/projects/types";
import { useClickOutside } from "@/features/agent/hooks/use-click-outside";
import {
  getSessionActivity,
  sessionActivity,
  subscribeSessionActivity,
  uniqueOpenSessions,
  useOpenSessions,
  useSessionActivity,
  type OpenAgentSession,
  type SessionActivity,
} from "@/features/agent/session-index";
import { isWorkingStatus } from "@/features/agent/runtime/session-status";
import { PinButton, SessionStatusMark } from "@/features/agent/ui/projects-nav/nav-chrome";
import { hrefWithOpenNonce, setSessionArchive } from "@/features/agent/ui/projects-nav/helpers";
import {
  formatRelative,
  orderByRecency,
  recentsTimestamp,
} from "@/features/agent/ui/session-recency";
import { useProjectsNavSessionPrefs } from "@/features/agent/ui/projects-nav/use-projects-nav-effects";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import type { AggregatedSession } from "@shared/agent/session-summary";

const RECENT_LIMIT = 40;
const PINNED_LABEL = "Pinned";
const COLLAPSED_KEY = "local-studio.sidebar.recents.collapsed";
const SESSION_MENU_CLASS = `absolute right-0 top-6 isolate z-[999] min-w-[180px] ${POPOVER_MENU_CLASS}`;

type RecentsRowData = {
  key: string;
  sessionId: string | null;
  projectId: string;
  title: string;
  preview: string;
  projectName: string;
  modelId?: string | null;
  provider?: string | null;
  timestamp: string;
  href: string;
  activity: SessionActivity;
  status?: string;
  isOpen: boolean;
  pinned: boolean;
  canArchive: boolean;
};

function sameActiveSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((id) => right.has(id));
}

function dayLabel(iso: string): string {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return "Older";
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const dayMs = 86_400_000;
  const daysAgo = Math.floor((startOfToday.getTime() - ts) / dayMs) + 1;
  if (ts >= startOfToday.getTime()) return "Today";
  if (daysAgo <= 1) return "Yesterday";
  if (daysAgo < 7) return "Last 7 days";
  if (daysAgo < 30) return "Last 30 days";
  return new Date(ts).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function displayTitle(value: string | null | undefined): string {
  let text = cleanSessionTitle(value);
  if (text.startsWith("<")) {
    text = cleanSessionTitle(text.replace(/^<[^>]+>\s*/, "")) || text;
  }
  return cleanSessionTitle(
    text
      .replace(/Attachment \d+:\s+\S+\s+\([^)]+\)\s*/gi, "")
      .replace(/Image is attached as multimodal input\.[^.]*\.\s*/gi, "")
      .replace(/^Previous run summary \(context, may be stale\):\s*/i, ""),
  );
}

function rowTitle(session: AggregatedSession, prefs: SessionPrefs): string {
  const named = displayTitle(prefs[session.id]?.title);
  if (named) return named;
  const first = displayTitle(session.firstUserMessage);
  const last = displayTitle(session.lastUserPromptText);
  const visible = first.startsWith("<") && last ? last : first || last;
  return visible || `Session ${session.id.slice(0, 8)}`;
}

function rowPreview(session: AggregatedSession, title: string): string {
  const last = displayTitle(session.lastUserPromptText);
  if (!last || last === title || title.startsWith(last)) return "";
  if (last.startsWith(title)) {
    if (/\w$/.test(title) && /^\w/.test(last.slice(title.length))) return "";
    const rest = last.slice(title.length).replace(/^[\s·—:,.-]+/, "");
    return rest.length > 2 ? rest : "";
  }
  return last;
}

function shortModel(modelId: string | null | undefined): string {
  if (!modelId) return "";
  return modelId.split("/").filter(Boolean).pop() ?? modelId;
}

function cwdName(cwd: string): string {
  const parts = cwd.split("/").filter(Boolean);
  return parts.at(-1) ?? cwd;
}

function rowMeta(row: RecentsRowData): string {
  const project = isChatsProject({ id: row.projectId }) ? "" : row.projectName;
  const model = shortModel(row.modelId) || row.provider || "";
  const parts = [project, model, row.preview].filter(Boolean);
  return parts.join(" · ");
}

function matchingOpen(
  session: AggregatedSession,
  opens: readonly OpenAgentSession[],
): OpenAgentSession | undefined {
  return opens.find((open) => open.threadId === session.id || open.id === session.id);
}

function sessionHref(projectId: string, sessionId: string | null | undefined): string {
  const sessionParam = sessionId ? `&session=${encodeURIComponent(sessionId)}` : "";
  return `/agent?project=${encodeURIComponent(projectId)}${sessionParam}&replace=1`;
}

function readCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((item): item is string => typeof item === "string"));
  } catch {
    return new Set();
  }
}

function writeCollapsed(collapsed: Set<string>) {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]));
  } catch {
    return;
  }
}

export function RecentSessionsSection() {
  const [sessions, setSessions] = useState<AggregatedSession[] | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const prefs = useProjectsNavSessionPrefs();
  const openSessions = useOpenSessions();
  const activitySnapshot = useSessionActivity();
  const [, setTick] = useState(0);

  useMountSubscription(() => {
    setCollapsed(readCollapsed());
  }, []);

  useMountSubscription(() => {
    const id = window.setInterval(() => setTick((value) => value + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

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

  const visible = useMemo(() => {
    return (sessions ?? []).filter(
      (session) => !session.archived && !session.parentSessionId && !prefs[session.id]?.hidden,
    );
  }, [sessions, prefs]);

  const liveRows = useMemo(() => {
    const opens = uniqueOpenSessions(openSessions);
    const byThread = new Map(visible.map((session) => [session.id, session]));
    const rows: RecentsRowData[] = [];
    for (const open of opens) {
      const activity = sessionActivity(
        [open.id, open.threadId],
        activitySnapshot,
        open.status,
        open.focused,
      );
      if (activity !== "running" && !isWorkingStatus(open.status)) continue;
      const archived = open.threadId ? byThread.get(open.threadId) : undefined;
      const sessionId = open.threadId ?? archived?.id ?? null;
      const title = archived
        ? rowTitle(archived, prefs)
        : displayTitle(prefs[sessionId ?? ""]?.title) ||
          displayTitle(open.title) ||
          "Current session";
      rows.push({
        key: `live:${sessionId ?? open.id}`,
        sessionId,
        projectId: open.projectId,
        title,
        preview: archived ? rowPreview(archived, title) : "",
        projectName: archived?.projectName || cwdName(open.cwd),
        modelId: open.modelId ?? archived?.modelId,
        provider: archived?.provider,
        timestamp: open.startedAt || open.updatedAt,
        href: sessionHref(open.projectId, open.threadId),
        activity: "running",
        status: open.status,
        isOpen: open.focused,
        pinned: Boolean(sessionId && prefs[sessionId]?.pinned),
        canArchive: Boolean(archived),
      });
    }
    return rows;
  }, [activitySnapshot, openSessions, prefs, visible]);

  const liveKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const row of liveRows) {
      if (row.sessionId) keys.add(row.sessionId);
    }
    return keys;
  }, [liveRows]);

  const groups = useMemo(() => {
    const ordered = orderByRecency(visible)
      .filter((session) => !liveKeys.has(session.id))
      .slice(0, RECENT_LIMIT);
    const buckets = new Map<string, RecentsRowData[]>();
    const push = (row: RecentsRowData) => {
      const label = row.pinned ? PINNED_LABEL : dayLabel(row.timestamp);
      const existing = buckets.get(label);
      if (existing) existing.push(row);
      else buckets.set(label, [row]);
    };
    for (const row of liveRows) push(row);
    for (const session of ordered) {
      const title = rowTitle(session, prefs);
      const open = matchingOpen(session, openSessions);
      push({
        key: session.id,
        sessionId: session.id,
        projectId: session.projectId,
        title,
        preview: rowPreview(session, title),
        projectName: session.projectName,
        modelId: open?.modelId ?? session.modelId,
        provider: session.provider,
        timestamp: recentsTimestamp(session),
        href: sessionHref(session.projectId, session.id),
        activity: sessionActivity(
          [session.id, open?.id ?? null, open?.threadId ?? null],
          activitySnapshot,
          open?.status,
          open?.focused,
        ),
        status: open?.status,
        isOpen: openSessions.some(
          (entry) => entry.focused && (entry.threadId === session.id || entry.id === session.id),
        ),
        pinned: Boolean(prefs[session.id]?.pinned),
        canArchive: true,
      });
    }
    const orderedLabels = [...buckets.keys()].sort((left, right) => {
      if (left === PINNED_LABEL) return -1;
      if (right === PINNED_LABEL) return 1;
      return 0;
    });
    return orderedLabels.map((label) => ({ label, rows: buckets.get(label) ?? [] }));
  }, [activitySnapshot, liveKeys, liveRows, openSessions, prefs, visible]);

  const toggleGroup = (label: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(label)) next.add(label);
      writeCollapsed(next);
      return next;
    });
  };

  if (sessions === null) {
    return <div className="px-2 py-1 text-[length:var(--fs-sm)] text-(--dim)">Loading…</div>;
  }
  if (liveRows.length === 0 && groups.length === 0) {
    return (
      <div className="px-2 py-2 text-[length:var(--fs-sm)] text-(--dim)">
        No recent chats. ⌘N starts a task.
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {groups.map((group) => (
        <RecentsGroup
          key={group.label}
          label={group.label}
          rows={group.rows}
          open={!collapsed.has(group.label)}
          onToggle={() => toggleGroup(group.label)}
        />
      ))}
    </div>
  );
}

function RecentsGroup({
  label,
  rows,
  open,
  onToggle,
}: {
  label: string;
  rows: RecentsRowData[];
  open: boolean;
  onToggle: () => void;
}) {
  const hasLive = rows.some((row) => row.activity === "running" || row.activity === "unseen");
  return (
    <div className="flex flex-col">
      <div className="group/header flex items-center px-2 pb-1 pt-3">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[length:var(--fs-xs)] font-medium text-(--dim) hover:text-(--fg)/85 focus-visible:text-(--fg)/85 focus-visible:outline-none"
          aria-expanded={open}
        >
          <span className="truncate">{label}</span>
          <ChevronDownIcon
            className={`h-3 w-3 shrink-0 opacity-0 transition-[transform,opacity] group-hover/header:opacity-55 ${
              open ? "" : "-rotate-90 opacity-45"
            }`}
          />
          {!open && hasLive ? (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-(--link)" aria-hidden />
          ) : null}
        </button>
      </div>
      {open ? (
        <div className="flex flex-col gap-[2px]">
          {rows.map((row) => (
            <RecentsRow key={row.key} row={row} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function RecentsRow({ row }: { row: RecentsRowData }) {
  const router = useRouter();
  const { findById } = useProjects();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(row.title);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useClickOutside(menuRef, menuOpen, () => setMenuOpen(false));
  const age = formatRelative(row.timestamp);
  const meta = rowMeta(row);
  const prefKey = row.sessionId;

  const startRename = () => {
    if (!prefKey) return;
    setDraft(row.title);
    setRenaming(true);
    setMenuOpen(false);
  };
  const finishRename = () => {
    if (!prefKey) {
      setRenaming(false);
      return;
    }
    const trimmed = draft.trim();
    patchSessionPref(prefKey, { title: trimmed || undefined });
    setRenaming(false);
  };
  const togglePin = () => {
    if (!prefKey) return;
    patchSessionPref(prefKey, { pinned: row.pinned ? undefined : true });
  };
  const archive = () => {
    if (!prefKey || !row.canArchive) return;
    const project = findById(row.projectId);
    if (!project) {
      patchSessionPref(prefKey, { hidden: true, pinned: undefined });
      return;
    }
    void setSessionArchive(prefKey, project, row.title, true).then(() =>
      patchSessionPref(prefKey, { hidden: undefined, pinned: undefined }),
    );
  };

  if (renaming) {
    return (
      <div className="flex h-[var(--sidebar-row-height)] items-center rounded-[var(--sidebar-row-radius)] bg-(--surface)/40 px-2">
        <input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={finishRename}
          onKeyDown={(event) => {
            if (event.key === "Enter") finishRename();
            if (event.key === "Escape") {
              setDraft(row.title);
              setRenaming(false);
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-[length:var(--fs-md)] text-(--fg) outline-none"
        />
      </div>
    );
  }

  return (
    <div
      className={`group relative flex min-h-[var(--sidebar-row-height)] items-center rounded-[var(--sidebar-row-radius)] px-2 ${
        row.isOpen ? "bg-(--active)" : "hover:bg-(--hover)"
      } ${menuOpen ? "z-[900]" : "z-0"}`}
      onContextMenu={(event: MouseEvent) => {
        if (!prefKey) return;
        event.preventDefault();
        setMenuOpen(true);
      }}
    >
      <Link
        href={row.href}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          router.push(hrefWithOpenNonce(row.href));
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          startRename();
        }}
        title={[row.title, meta].filter(Boolean).join(" — ")}
        aria-current={row.isOpen ? "page" : undefined}
        className={`flex min-w-0 flex-1 flex-col justify-center group-hover:pr-[52px] group-has-[:focus-visible]:pr-[52px] ${
          meta ? "py-[5px]" : ""
        }`}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className={`min-w-0 flex-1 truncate text-[length:var(--fs-md)] leading-5 ${
              row.isOpen ? "text-(--fg)" : "text-(--fg)/78 group-hover:text-(--fg)/95"
            }`}
          >
            {row.title}
          </span>
          <SessionStatusMark
            activity={row.activity}
            runningClass="flex shrink-0"
            dotClass="h-1.5 w-1.5 shrink-0 rounded-full"
          />
          {row.activity === "running" ? null : (
            <span className="shrink-0 text-[length:var(--fs-2xs)] tabular-nums text-(--hl2) group-hover:hidden group-has-[:focus-visible]:hidden">
              {age}
            </span>
          )}
        </span>
        {meta ? (
          <span className="min-w-0 truncate text-[length:var(--fs-2xs)] leading-4 text-(--hl2)">
            {meta}
          </span>
        ) : null}
      </Link>
      {prefKey ? (
        <div
          ref={menuRef}
          className={`absolute right-1 top-1/2 z-20 flex -translate-y-1/2 shrink-0 items-center gap-0.5 rounded-md bg-[inherit] transition-opacity duration-150 ${
            menuOpen
              ? "opacity-100"
              : "pointer-events-none opacity-0 focus-within:pointer-events-auto focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
          }`}
        >
          <PinButton pinned={row.pinned} onToggle={togglePin} target="session" />
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setMenuOpen((value) => !value);
            }}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-(--dim) transition-colors hover:bg-(--hover) hover:text-(--fg)"
            aria-label="Session options"
            title="Session options"
          >
            <MoreIcon className="pointer-events-none h-3.5 w-3.5" />
          </button>
          {menuOpen ? (
            <div className={SESSION_MENU_CLASS} role="menu">
              <MenuItem
                Icon={row.pinned ? PinOffIcon : PinIcon}
                onClick={() => {
                  setMenuOpen(false);
                  togglePin();
                }}
              >
                {row.pinned ? "Unpin" : "Pin"}
              </MenuItem>
              <MenuItem Icon={SquarePen} onClick={startRename}>
                Rename
              </MenuItem>
              {row.canArchive ? (
                <MenuItem
                  Icon={Archive}
                  onClick={() => {
                    setMenuOpen(false);
                    archive();
                  }}
                >
                  Archive
                </MenuItem>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
