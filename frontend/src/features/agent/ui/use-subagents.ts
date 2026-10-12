"use client";

// One poll of a session's subagents, shared by every surface that shows them.
//
// The transcript renders a row where each child was spawned and the status
// panel lists all of them; before this hook each surface fetched on its own
// timer, so a session with both open polled the runtime twice as often and the
// two could disagree for a beat. The cache is keyed by parent pi session id and
// refcounted: the first subscriber starts the interval, the last one clears it.

import { useState } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

export type SubagentRun = {
  id: string;
  name: string;
  piSessionId: string | null;
  status: "running" | "done" | "error" | "cancelled";
  /** False while "running" means the child is registered but not streaming. */
  active?: boolean;
  startedAt: string;
  finishedAt: string | null;
  error?: string;
};

const POLL_MS = 4000;

type Entry = {
  runs: SubagentRun[];
  listeners: Set<(runs: SubagentRun[]) => void>;
  timer: number | null;
};

const cache = new Map<string, Entry>();

async function fetchSubagents(parentPiSessionId: string): Promise<SubagentRun[] | null> {
  try {
    const response = await fetch(
      `/api/agent/subagents?piSessionId=${encodeURIComponent(parentPiSessionId)}`,
      { cache: "no-store" },
    );
    if (!response.ok) return null;
    const payload = (await response.json()) as { subagents?: SubagentRun[] };
    return Array.isArray(payload.subagents) ? payload.subagents : [];
  } catch {
    // Transient — the next tick retries. Null means "no answer", which is not
    // the same as "no subagents": keep whatever we last knew.
    return null;
  }
}

function entryFor(piSessionId: string): Entry {
  const existing = cache.get(piSessionId);
  if (existing) return existing;
  const created: Entry = { runs: [], listeners: new Set(), timer: null };
  cache.set(piSessionId, created);
  return created;
}

function publish(piSessionId: string, runs: SubagentRun[]): void {
  const entry = cache.get(piSessionId);
  if (!entry) return;
  entry.runs = runs;
  for (const listener of entry.listeners) listener(runs);
}

/** Every subagent this session spawned, refreshed on one shared timer. */
export function useSubagents(piSessionId: string | null): SubagentRun[] {
  const [runs, setRuns] = useState<SubagentRun[]>(() =>
    piSessionId ? (cache.get(piSessionId)?.runs ?? []) : [],
  );

  useMountSubscription(() => {
    if (!piSessionId) {
      setRuns([]);
      return;
    }
    const entry = entryFor(piSessionId);
    // Seed from whatever the shared cache already holds so a second surface
    // renders immediately instead of waiting out a poll.
    setRuns(entry.runs);
    entry.listeners.add(setRuns);
    const load = async () => {
      const next = await fetchSubagents(piSessionId);
      if (next) publish(piSessionId, next);
    };
    if (entry.timer === null) {
      void load();
      entry.timer = window.setInterval(() => void load(), POLL_MS);
    }
    return () => {
      entry.listeners.delete(setRuns);
      if (entry.listeners.size > 0) return;
      if (entry.timer !== null) window.clearInterval(entry.timer);
      entry.timer = null;
    };
  }, [piSessionId]);

  return runs;
}

export function subagentStatusLabel(run: SubagentRun): string {
  if (run.status === "running") return run.active === false ? "idle" : "working";
  if (run.status === "done") return "done";
  if (run.status === "cancelled") return "stopped";
  return "failed";
}

export const SUBAGENT_STATUS_DOT: Record<SubagentRun["status"], string> = {
  running: "bg-(--ok)",
  done: "bg-(--ok)",
  error: "bg-(--err)",
  cancelled: "bg-(--fg)/30",
};
