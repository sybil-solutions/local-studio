"use client";

import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { ChatIcon, Folder } from "@/components/icons";
import { cleanSessionTitle } from "@/lib/agent/session/helpers";
import { safeJson } from "@/lib/agent/safe-json";

// Aggregated session row returned by /api/agent/sessions/all. Mirrored here
// so the component is decoupled from the API module.
type AggregatedSession = {
  id: string;
  projectId: string;
  projectName: string;
  projectPath: string;
  modelId: string | null;
  firstUserMessage: string | null;
  turnCount: number;
  startedAt: string;
  updatedAt: string;
};

type ActiveSession = {
  projectId: string;
  cwd: string;
  paneId: string;
  tabId: string;
  piSessionId: string | null;
  title: string;
  status: string;
  active?: boolean;
  updatedAt: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  activeSessions: ActiveSession[];
};

function formatRelative(iso: string): string {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return "";
  const delta = Date.now() - ts;
  const minute = 60_000;
  const hour = 3_600_000;
  const day = 86_400_000;
  if (delta < minute) return "just now";
  if (delta < hour) return `${Math.floor(delta / minute)}m`;
  if (delta < day) return `${Math.floor(delta / hour)}h`;
  return `${Math.floor(delta / day)}d`;
}

function isRunning(status: string): boolean {
  return Boolean(status) && status !== "idle" && status !== "done";
}

export function SessionsCommand({ open, onClose, activeSessions }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [sessions, setSessions] = useState<AggregatedSession[] | null>(null);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const subscribeSessionIndex = useCallback(
    (_notify: () => void) => {
      if (!open) return () => {};
      let cancelled = false;
      void (async () => {
        try {
          const response = await fetch("/api/agent/sessions/all?since=30d", { cache: "no-store" });
          const payload = await safeJson<{ sessions?: AggregatedSession[] }>(response);
          if (!cancelled) setSessions(payload.sessions ?? []);
        } catch {
          if (!cancelled) setSessions([]);
        }
      })();
      return () => {
        cancelled = true;
      };
    },
    [open],
  );

  const subscribeOpenFocus = useCallback(
    (_notify: () => void) => {
      if (!open) return () => {};
      const frame = requestAnimationFrame(() => {
        setQuery("");
        setHighlight(0);
        inputRef.current?.focus();
      });
      return () => cancelAnimationFrame(frame);
    },
    [open],
  );

  useSyncExternalStore(
    subscribeSessionIndex,
    getSessionsCommandSnapshot,
    getSessionsCommandSnapshot,
  );
  useSyncExternalStore(subscribeOpenFocus, getSessionsCommandSnapshot, getSessionsCommandSnapshot);

  // Index active sessions by piSessionId so we can mark stored sessions that
  // are currently running in a pane.
  const activeByPiId = useMemo(() => {
    const map = new Map<string, ActiveSession>();
    for (const session of activeSessions) {
      if (session.piSessionId) map.set(session.piSessionId, session);
    }
    return map;
  }, [activeSessions]);

  // Active sessions that aren't yet persisted to disk (no piSessionId yet, or
  // running tabs we want to surface ahead of stored history).
  const liveOnlyActives = useMemo(
    () => activeSessions.filter((session) => isRunning(session.status)),
    [activeSessions],
  );

  const filtered = useMemo(() => {
    const all = sessions ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return all.slice(0, 60);
    return all
      .filter((session) => {
        const haystack =
          `${session.firstUserMessage ?? ""} ${session.projectName} ${session.modelId ?? ""}`.toLowerCase();
        return haystack.includes(q);
      })
      .slice(0, 80);
  }, [sessions, query]);

  const liveFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return liveOnlyActives;
    return liveOnlyActives.filter((session) =>
      `${session.title} ${session.status}`.toLowerCase().includes(q),
    );
  }, [liveOnlyActives, query]);

  const totalRows = liveFiltered.length + filtered.length;
  const selectedIndex = totalRows > 0 ? Math.min(highlight, totalRows - 1) : 0;

  if (!open) return null;

  function commit(index: number) {
    if (index < 0) return;
    if (index < liveFiltered.length) {
      const session = liveFiltered[index];
      router.push(
        `/agent?project=${encodeURIComponent(session.projectId)}${
          session.piSessionId ? `&session=${encodeURIComponent(session.piSessionId)}` : ""
        }`,
      );
      onClose();
      return;
    }
    const session = filtered[index - liveFiltered.length];
    if (!session) return;
    router.push(
      `/agent?project=${encodeURIComponent(session.projectId)}&session=${encodeURIComponent(session.id)}`,
    );
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        className="absolute inset-0 bg-black/55 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close session search"
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 flex max-h-[68vh] w-[min(720px,92vw)] flex-col overflow-hidden rounded-2xl border border-(--border) bg-(--surface) shadow-[0_24px_80px_rgba(0,0,0,0.5)]"
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setHighlight((h) => Math.min(totalRows - 1, h + 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setHighlight((h) => Math.max(0, h - 1));
          } else if (event.key === "Enter") {
            event.preventDefault();
            commit(selectedIndex);
          } else if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <div className="flex items-center gap-2 border-b border-(--separator) px-4 py-3">
          <Search className="h-4 w-4 text-(--dim)" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlight(0);
            }}
            placeholder="Search every session by prompt, project, or model…"
            className="flex-1 bg-transparent text-[14px] text-(--fg) outline-none placeholder:text-(--dim)"
          />
          <kbd className="rounded bg-(--surface-2) px-1.5 py-0.5 text-[10px] text-(--dim)">esc</kbd>
        </div>
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1">
          {sessions === null ? (
            <div className="px-4 py-6 text-[12px] text-(--dim)">Loading sessions…</div>
          ) : totalRows === 0 ? (
            <div className="px-4 py-8 text-center text-[12px] text-(--dim)">
              No sessions match “{query}”.
            </div>
          ) : (
            <>
              {liveFiltered.length > 0 ? <SectionLabel>Running now</SectionLabel> : null}
              {liveFiltered.map((session, index) => {
                const i = index;
                const active = selectedIndex === i;
                return (
                  <button
                    key={`live:${session.paneId}:${session.tabId}`}
                    type="button"
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => commit(i)}
                    className={`flex w-full items-center gap-3 px-4 py-2 text-left text-[13px] transition-colors ${
                      active ? "bg-(--bg)" : "hover:bg-(--bg)/70"
                    }`}
                  >
                    <span
                      className="inline-block h-2 w-2 shrink-0 rounded-full bg-(--hl2) animate-pulse"
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate text-(--fg)">
                      {cleanSessionTitle(session.title) || "Current session"}
                    </span>
                    <span className="shrink-0 truncate text-[11px] text-(--dim)">
                      {session.status}
                    </span>
                  </button>
                );
              })}
              {filtered.length > 0 ? <SectionLabel>Recent sessions</SectionLabel> : null}
              {filtered.map((session, index) => {
                const i = liveFiltered.length + index;
                const active = selectedIndex === i;
                const running = activeByPiId.has(session.id);
                const label =
                  cleanSessionTitle(session.firstUserMessage) ||
                  `Session ${session.id.slice(0, 8)}`;
                return (
                  <button
                    key={session.id}
                    type="button"
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => commit(i)}
                    className={`flex w-full items-center gap-3 px-4 py-2 text-left text-[13px] transition-colors ${
                      active ? "bg-(--bg)" : "hover:bg-(--bg)/70"
                    }`}
                  >
                    {running ? (
                      <span
                        className="inline-block h-2 w-2 shrink-0 rounded-full bg-(--hl2) animate-pulse"
                        aria-hidden
                      />
                    ) : (
                      <ChatIcon className="h-3.5 w-3.5 shrink-0 text-(--dim)" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-(--fg)">{label}</span>
                    <span className="inline-flex items-center gap-1 shrink-0 truncate text-[11px] text-(--dim)">
                      <Folder className="h-3 w-3" />
                      {session.projectName}
                    </span>
                    <span className="w-12 shrink-0 text-right text-[11px] text-(--dim)">
                      {formatRelative(session.updatedAt)}
                    </span>
                  </button>
                );
              })}
            </>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-(--separator) px-4 py-2 text-[11px] text-(--dim)">
          <span>
            {totalRows} result{totalRows === 1 ? "" : "s"}
          </span>
          <span className="flex items-center gap-2">
            <kbd className="rounded bg-(--surface-2) px-1.5 py-0.5">↑</kbd>
            <kbd className="rounded bg-(--surface-2) px-1.5 py-0.5">↓</kbd>
            navigate
            <kbd className="ml-2 rounded bg-(--surface-2) px-1.5 py-0.5">↵</kbd>
            open
          </span>
        </div>
      </div>
    </div>
  );
}

const getSessionsCommandSnapshot = (): number => 0;

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="px-4 pb-1 pt-3 text-[10px] font-medium uppercase tracking-[var(--section-tracking)] text-(--dim)">
      {children}
    </div>
  );
}
