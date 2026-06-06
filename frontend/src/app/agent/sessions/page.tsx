"use client";

import Link from "next/link";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { ChevronDown, Folder, RefreshCw, Search as SearchIcon } from "lucide-react";
import { cleanSessionTitle } from "@/lib/agent/session/helpers";
import { safeJson } from "@/lib/agent/safe-json";
import { ACTIVE_AGENT_SESSIONS_EVENT } from "@/lib/agent/workspace/events";

// Mirrors the API payload from /api/agent/sessions/all. Kept inline so this
// page doesn't import server-only modules into the client bundle.
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
  filename: string;
};

type ActiveSession = {
  projectId: string;
  cwd: string;
  paneId: string;
  tabId: string;
  piSessionId: string | null;
  title: string;
  status: string;
  focused?: boolean;
  updatedAt: string;
};

type StatusFilter = "all" | "running" | "idle";
type SortField = "updatedAt" | "turnCount" | "projectName";

function isRunning(status: string): boolean {
  return Boolean(status) && status !== "idle" && status !== "done";
}

function formatRelative(iso: string): string {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return "";
  const delta = Date.now() - ts;
  if (delta < 60_000) return "just now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return `${Math.floor(delta / 86_400_000)}d ago`;
}

export default function AgentSessionsPage() {
  const [sessions, setSessions] = useState<AggregatedSession[] | null>(null);
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<SortField>("updatedAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/agent/sessions/all?since=90d", { cache: "no-store" });
      const payload = await safeJson<{ sessions?: AggregatedSession[] }>(response);
      setSessions(payload.sessions ?? []);
    } catch {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const subscribeSessionRows = useCallback(
    (_notify: () => void) => {
      void reload();
      return () => {};
    },
    [reload],
  );

  const subscribeActiveSessions = useCallback((_notify: () => void) => {
    const onActive = (event: Event) => {
      const detail = (event as CustomEvent<{ sessions?: ActiveSession[] }>).detail;
      setActiveSessions(Array.isArray(detail?.sessions) ? detail.sessions : []);
    };
    window.addEventListener(ACTIVE_AGENT_SESSIONS_EVENT, onActive);
    return () => window.removeEventListener(ACTIVE_AGENT_SESSIONS_EVENT, onActive);
  }, []);

  useSyncExternalStore(subscribeSessionRows, getAgentSessionsSnapshot, getAgentSessionsSnapshot);
  useSyncExternalStore(subscribeActiveSessions, getAgentSessionsSnapshot, getAgentSessionsSnapshot);

  const activeByPiId = useMemo(() => {
    const map = new Map<string, ActiveSession>();
    for (const session of activeSessions) {
      if (session.piSessionId) map.set(session.piSessionId, session);
    }
    return map;
  }, [activeSessions]);

  const projects = useMemo(() => {
    const seen = new Map<string, string>();
    for (const session of sessions ?? []) {
      if (!seen.has(session.projectId)) seen.set(session.projectId, session.projectName);
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [sessions]);

  const rows = useMemo(() => {
    const all = sessions ?? [];
    const q = query.trim().toLowerCase();
    const filtered = all.filter((session) => {
      if (projectFilter !== "all" && session.projectId !== projectFilter) return false;
      if (statusFilter === "running" && !activeByPiId.has(session.id)) return false;
      if (statusFilter === "idle" && activeByPiId.has(session.id)) return false;
      if (!q) return true;
      const haystack =
        `${session.firstUserMessage ?? ""} ${session.projectName} ${session.modelId ?? ""}`.toLowerCase();
      return haystack.includes(q);
    });
    const sorted = [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortField === "updatedAt") cmp = a.updatedAt.localeCompare(b.updatedAt);
      else if (sortField === "turnCount") cmp = a.turnCount - b.turnCount;
      else if (sortField === "projectName") cmp = a.projectName.localeCompare(b.projectName);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [sessions, query, projectFilter, statusFilter, activeByPiId, sortField, sortDir]);

  // Counts surfaced in the header chips so the user can see at a glance what
  // is happening across every project.
  const summary = useMemo(() => {
    const total = sessions?.length ?? 0;
    const visible = rows.length;
    const runningCount = activeSessions.filter((s) => isRunning(s.status)).length;
    const projectsCount = projects.length;
    return { total, visible, runningCount, projectsCount };
  }, [sessions, rows.length, activeSessions, projects]);

  function toggleSort(field: SortField) {
    if (field === sortField) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  return (
    <div className="min-h-full bg-(--bg) text-(--fg)">
      <div className="mx-auto max-w-[1280px] px-6 py-8">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <div className="text-[length:var(--fs-xs)] font-medium uppercase tracking-[var(--section-tracking)] text-(--dim)">
              Agent
            </div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Sessions</h1>
            <p className="mt-1 text-[length:var(--fs-base)] text-(--dim)">
              Every conversation with the agent across every project. Search, filter, and jump into
              any one of them.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <SummaryChip
              label="Sessions"
              value={
                summary.visible === summary.total
                  ? summary.total
                  : `${summary.visible}/${summary.total}`
              }
            />
            <SummaryChip
              label="Running"
              value={summary.runningCount}
              accent={summary.runningCount > 0}
            />
            <SummaryChip label="Projects" value={summary.projectsCount} />
            <button
              type="button"
              onClick={() => void reload()}
              className="inline-flex h-8 items-center gap-2 rounded-md bg-(--surface) px-3 text-[length:var(--fs-md)] text-(--dim) hover:bg-(--surface-2) hover:text-(--fg)"
              title="Refresh"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex h-9 min-w-[280px] flex-1 items-center gap-2 rounded-md bg-(--surface) px-3">
            <SearchIcon className="h-3.5 w-3.5 text-(--dim)" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by prompt, project, model…"
              className="flex-1 bg-transparent text-[length:var(--fs-base)] outline-none placeholder:text-(--dim)"
            />
            <kbd className="rounded bg-(--surface-2) px-1.5 py-0.5 text-[length:var(--fs-xs)] text-(--dim)">
              ⌘K
            </kbd>
          </div>
          <FilterPills
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { id: "all", label: "All" },
              { id: "running", label: "Running" },
              { id: "idle", label: "Idle" },
            ]}
          />
          <ProjectSelect
            value={projectFilter}
            onChange={setProjectFilter}
            options={[
              { id: "all", name: "All projects" },
              ...projects.map(([id, name]) => ({ id, name })),
            ]}
          />
        </div>

        <div className="mt-4 overflow-hidden rounded-lg bg-(--surface)">
          <table className="w-full text-left text-[length:var(--fs-base)]">
            <thead className="bg-(--surface-2) text-[length:var(--fs-xs)] uppercase tracking-[0.14em] text-(--dim)">
              <tr>
                <th className="w-10 px-3 py-2"></th>
                <th className="px-3 py-2">Title</th>
                <SortHeader
                  label="Project"
                  field="projectName"
                  sortField={sortField}
                  sortDir={sortDir}
                  onClick={toggleSort}
                />
                <th className="px-3 py-2">Model</th>
                <SortHeader
                  label="Turns"
                  field="turnCount"
                  sortField={sortField}
                  sortDir={sortDir}
                  onClick={toggleSort}
                  align="right"
                />
                <SortHeader
                  label="Updated"
                  field="updatedAt"
                  sortField={sortField}
                  sortDir={sortDir}
                  onClick={toggleSort}
                  align="right"
                />
              </tr>
            </thead>
            <tbody>
              {sessions === null ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-8 text-center text-[length:var(--fs-md)] text-(--dim)"
                  >
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-10 text-center text-[length:var(--fs-md)] text-(--dim)"
                  >
                    No sessions match these filters.
                  </td>
                </tr>
              ) : (
                rows.map((session) => {
                  const running = activeByPiId.has(session.id);
                  const status = activeByPiId.get(session.id)?.status ?? "idle";
                  const label =
                    cleanSessionTitle(session.firstUserMessage) ||
                    `Session ${session.id.slice(0, 8)}`;
                  return (
                    <tr
                      key={session.id}
                      className="border-t border-(--separator) hover:bg-(--surface-2)"
                    >
                      <td className="px-3 py-2">
                        <span
                          className={`inline-block h-1.5 w-1.5 rounded-full ${
                            running ? "bg-(--hl2) animate-pulse" : "bg-(--dim)"
                          }`}
                          title={running ? `Running: ${status}` : "Idle"}
                          aria-hidden
                        />
                      </td>
                      <td className="px-3 py-2 text-(--fg)">
                        <Link
                          href={`/agent?project=${encodeURIComponent(session.projectId)}&session=${encodeURIComponent(session.id)}`}
                          className="line-clamp-1 hover:underline"
                          title={label}
                        >
                          {label}
                        </Link>
                        {running ? (
                          <span className="ml-2 text-[length:var(--fs-xs)] text-(--dim)">
                            {status}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-(--dim)">
                        <span className="inline-flex items-center gap-1.5">
                          <Folder className="h-3 w-3" />
                          {session.projectName}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-[length:var(--fs-sm)] text-(--dim)">
                        {session.modelId ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-(--dim)">
                        {session.turnCount}
                      </td>
                      <td className="px-3 py-2 text-right text-(--dim)">
                        {formatRelative(session.updatedAt)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const getAgentSessionsSnapshot = (): number => 0;

function SummaryChip({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: number | string;
  accent?: boolean;
}) {
  return (
    <div
      className={`flex h-9 items-center gap-2 rounded-md px-3 text-[length:var(--fs-md)] ${
        accent ? "bg-(--hl2)/15 text-(--fg)" : "bg-(--surface) text-(--dim)"
      }`}
    >
      <span className="uppercase tracking-[var(--section-tracking)] text-[length:var(--fs-xs)]">
        {label}
      </span>
      <span className="font-mono tabular-nums text-(--fg)">{value}</span>
    </div>
  );
}

function FilterPills<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (next: T) => void;
  options: Array<{ id: T; label: string }>;
}) {
  return (
    <div className="flex h-9 items-center gap-1 rounded-md bg-(--surface) p-1">
      {options.map((option) => {
        const active = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            className={`h-7 rounded px-3 text-[length:var(--fs-md)] transition-colors ${
              active ? "bg-(--bg) text-(--fg) shadow-sm" : "text-(--dim) hover:text-(--fg)"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function ProjectSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (next: string) => void;
  options: Array<{ id: string; name: string }>;
}) {
  return (
    <label className="flex h-9 items-center gap-2 rounded-md bg-(--surface) px-3 text-[length:var(--fs-md)] text-(--dim)">
      <Folder className="h-3.5 w-3.5" />
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="bg-transparent text-[length:var(--fs-md)] text-(--fg) outline-none"
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function SortHeader({
  label,
  field,
  sortField,
  sortDir,
  onClick,
  align = "left",
}: {
  label: string;
  field: SortField;
  sortField: SortField;
  sortDir: "asc" | "desc";
  onClick: (field: SortField) => void;
  align?: "left" | "right";
}) {
  const active = field === sortField;
  return (
    <th className={`px-3 py-2 ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={() => onClick(field)}
        className={`inline-flex items-center gap-1 ${active ? "text-(--fg)" : ""}`}
      >
        {label}
        <ChevronDown
          className={`h-3 w-3 transition-transform ${
            active && sortDir === "asc" ? "rotate-180" : ""
          } ${active ? "opacity-100" : "opacity-30"}`}
        />
      </button>
    </th>
  );
}
