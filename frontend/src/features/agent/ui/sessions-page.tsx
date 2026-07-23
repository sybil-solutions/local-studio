"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { ChevronDown, Folder } from "@/ui/icon-registry";
import {
  AppPage,
  PageContainer,
  PageHeader,
  RefreshButton,
  Table,
  THead,
  TBody,
  TRow,
  TH,
  TCell,
  SearchInput,
  SegmentedControl,
  Select,
} from "@/ui";
import { cleanSessionTitle } from "@/features/agent/messages/helpers";
import { useOpenSessions } from "@/features/agent/ui/use-open-sessions";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { safeJson } from "@/features/agent/safe-json";

import { type SessionSortField, indexOpenByThreadId } from "@/features/agent/session-contracts";
import type { AggregatedSession } from "@shared/agent/session-summary";

type StatusFilter = "all" | "running" | "idle";

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
  const activeSessions = useOpenSessions();
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [sortField, setSessionSortField] = useState<SessionSortField>("updatedAt");
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

  useMountSubscription(() => {
    void reload();
  }, [reload]);

  const openByThreadId = useMemo(() => indexOpenByThreadId(activeSessions), [activeSessions]);

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
      if (statusFilter === "running" && !openByThreadId.has(session.id)) return false;
      if (statusFilter === "idle" && openByThreadId.has(session.id)) return false;
      if (!q) return true;
      const haystack =
        `${session.firstUserMessage ?? ""} ${session.projectName} ${session.modelId ?? ""}`.toLowerCase();
      return haystack.includes(q);
    });
    const sorted = [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortField === "updatedAt") cmp = a.updatedAt.localeCompare(b.updatedAt);
      else if (sortField === "projectName") cmp = a.projectName.localeCompare(b.projectName);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [sessions, query, projectFilter, statusFilter, openByThreadId, sortField, sortDir]);

  const summary = useMemo(() => {
    const total = sessions?.length ?? 0;
    const visible = rows.length;
    const runningCount = activeSessions.filter((s) => isRunning(s.status)).length;
    const projectsCount = projects.length;
    return { total, visible, runningCount, projectsCount };
  }, [sessions, rows.length, activeSessions, projects]);

  function toggleSort(field: SessionSortField) {
    if (field === sortField) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSessionSortField(field);
      setSortDir("desc");
    }
  }

  return (
    <AppPage>
      <PageContainer width="md">
        <PageHeader
          eyebrow="Agent"
          title="Sessions"
          description="Every conversation with the agent across every project. Search, filter, and jump into any one of them."
          actions={
            <>
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
              <RefreshButton onRefresh={() => void reload()} loading={loading} />
            </>
          }
        />

        <div className="grid gap-2 sm:grid-cols-[minmax(240px,1fr)_auto] lg:grid-cols-[minmax(280px,1fr)_auto_180px]">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search prompts, projects, or models"
          />
          <SegmentedControl
            value={statusFilter}
            onChange={setStatusFilter}
            size="sm"
            items={[
              { id: "all", label: "All" },
              { id: "running", label: "Running" },
              { id: "idle", label: "Idle" },
            ]}
          />
          <div className="sm:col-span-2 lg:col-span-1">
            <Select
              value={projectFilter}
              onChange={(event) => setProjectFilter(event.target.value)}
              aria-label="Filter sessions by project"
              options={[
                { value: "all", label: "All projects" },
                ...projects.map(([id, name]) => ({ value: id, label: name })),
              ]}
            />
          </div>
        </div>

        <Table className="mt-3">
          <THead>
            <TRow className="hover:bg-transparent">
              <TH className="w-9"></TH>
              <TH>Title</TH>
              <SortHeader
                label="Project"
                field="projectName"
                sortField={sortField}
                sortDir={sortDir}
                onClick={toggleSort}
              />
              <TH>Model</TH>
              <SortHeader
                label="Updated"
                field="updatedAt"
                sortField={sortField}
                sortDir={sortDir}
                onClick={toggleSort}
                align="right"
              />
            </TRow>
          </THead>
          <TBody>
            {sessions === null ? (
              <TRow>
                <TCell colSpan={5} className="py-8 text-center text-(--ui-muted)">
                  Loading sessions…
                </TCell>
              </TRow>
            ) : rows.length === 0 ? (
              <TRow>
                <TCell colSpan={5} className="py-10 text-center text-(--ui-muted)">
                  No sessions match these filters.
                </TCell>
              </TRow>
            ) : (
              rows.map((session) => {
                const running = openByThreadId.has(session.id);
                const status = openByThreadId.get(session.id)?.status ?? "idle";
                const label =
                  cleanSessionTitle(session.firstUserMessage) ||
                  `Session ${session.id.slice(0, 8)}`;
                return (
                  <TRow key={session.id}>
                    <TCell>
                      <span
                        className={`inline-block h-1.5 w-1.5 rounded-full ${
                          running ? "animate-pulse bg-(--ui-success)" : "bg-(--ui-muted)/45"
                        }`}
                        title={running ? `Running: ${status}` : "Idle"}
                        aria-hidden
                      />
                    </TCell>
                    <TCell className="text-(--ui-fg)">
                      <Link
                        href={`/agent?project=${encodeURIComponent(session.projectId)}&session=${encodeURIComponent(session.id)}&replace=1`}
                        className="line-clamp-1 font-medium hover:underline"
                        title={label}
                      >
                        {label}
                      </Link>
                      {running ? (
                        <span className="ml-2 text-[length:var(--fs-xs)] text-(--ui-muted)">
                          {status}
                        </span>
                      ) : null}
                    </TCell>
                    <TCell className="text-(--ui-muted)">
                      <span className="inline-flex items-center gap-1.5">
                        <Folder className="h-3 w-3" />
                        {session.projectName}
                      </span>
                    </TCell>
                    <TCell className="font-mono text-[length:var(--fs-sm)] text-(--ui-muted)">
                      {session.modelId ?? "—"}
                    </TCell>
                    <TCell className="text-right text-(--ui-muted)">
                      {formatRelative(session.updatedAt)}
                    </TCell>
                  </TRow>
                );
              })
            )}
          </TBody>
        </Table>
      </PageContainer>
    </AppPage>
  );
}

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
      className={`flex h-8 items-center gap-1.5 rounded-[var(--ui-radius)] border border-(--ui-separator) px-2.5 text-[length:var(--fs-sm)] ${
        accent ? "bg-(--ui-success)/10 text-(--ui-fg)" : "bg-(--ui-surface) text-(--ui-muted)"
      }`}
    >
      <span>{label}</span>
      <span className="font-mono tabular-nums text-(--ui-fg)">{value}</span>
    </div>
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
  field: SessionSortField;
  sortField: SessionSortField;
  sortDir: "asc" | "desc";
  onClick: (field: SessionSortField) => void;
  align?: "left" | "right";
}) {
  const active = field === sortField;
  return (
    <TH align={align}>
      <button
        type="button"
        onClick={() => onClick(field)}
        className={`inline-flex items-center gap-1 transition-colors hover:text-(--ui-fg) ${
          active ? "text-(--ui-fg)" : ""
        }`}
      >
        {label}
        <ChevronDown
          className={`h-3 w-3 transition-transform ${
            active && sortDir === "asc" ? "rotate-180" : ""
          } ${active ? "opacity-100" : "opacity-30"}`}
        />
      </button>
    </TH>
  );
}
