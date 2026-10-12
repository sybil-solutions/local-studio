//
// Subagents: child pi sessions a parent session's model spawns through the
// `subagent` tool, plus the management half it supervises them with —
// `subagent_list`, `subagent_status`, `subagent_stop`.
//
// Each subagent runs headless in this runtime under the reserved runtime key
// `subagent:<parent pi session id>:<run id>`, with its own context and its own
// canonical session file (so the UI can open it like any other session), and
// reports its final text back as the tool result.
//
// The registry below is keyed by parent pi session id, and that is what keeps
// the two safety properties intact as management grows:
//   * every lookup goes through the caller's own parent bucket, so a session
//     can only ever see, inspect, or stop the children it spawned itself;
//   * a child's runtime key carries the reserved prefix, so when it asks to
//     spawn, findParentRuntime resolves that key and the spawn is refused.
//

import { randomUUID } from "node:crypto";
import { getGlobalSingleton } from "./instances";
import { piRuntimeManager } from "./pi-runtime";
import { lastAssistantResult, type LastAssistantResult } from "./session-text";
import {
  listSubagentChildren,
  sessionSubagentLink,
  setSubagentLink,
} from "./session-metadata-store";

const NICKNAMES = [
  "Euclid",
  "Archimedes",
  "Hypatia",
  "Ptolemy",
  "Leibniz",
  "Lovelace",
  "Boole",
  "Turing",
  "Hopper",
  "Noether",
  "Curie",
  "Gauss",
  "Euler",
  "Ramanujan",
  "Erdos",
  "Franklin",
  "Kepler",
  "Darwin",
  "Fermi",
  "Bohr",
];

export const MAX_CONCURRENT_PER_PARENT = 4;
const MAX_RESULT_CHARS = 8000;
const SUBAGENT_SESSION_PREFIX = "subagent:";

/** A run is "running" until exactly one of its terminal states is written:
 *  "done"/"error" by the run itself, "cancelled" by stopSubagent. */
export type SubagentStatus = "running" | "done" | "error" | "cancelled";

export type SubagentRun = {
  id: string;
  parentPiSessionId: string;
  name: string;
  task: string;
  piSessionId: string | null;
  /** Reserved runtime key this child owns — also the no-nesting marker. */
  runtimeSessionId: string;
  cwd: string;
  status: SubagentStatus;
  startedAt: string;
  finishedAt: string | null;
  error?: string;
};

type SubagentState = {
  /** parent pi session id -> runs, newest last */
  byParent: Map<string, SubagentRun[]>;
  /** pi session ids that ARE subagents — they may not spawn their own */
  childPiSessionIds: Set<string>;
  /** parents whose durable children have been folded in this process. */
  rehydratedParents: Set<string>;
};

function state(): SubagentState {
  return getGlobalSingleton("subagentRegistry", () => ({
    byParent: new Map<string, SubagentRun[]>(),
    childPiSessionIds: new Set<string>(),
    rehydratedParents: new Set<string>(),
  }));
}

/**
 * Fold this parent's persisted children back into the in-memory registry.
 *
 * The registry dies with the process, but the parent link is durable — without
 * this, an app relaunch made subagent_list swear the session never spawned
 * anything while the sidebar still showed the children. A rehydrated run is
 * terminal by construction (the runtime that was driving it is gone), so it
 * comes back as "done" with its report still readable from the child's
 * transcript.
 */
function rehydrateParent(parentPiSessionId: string): void {
  const registry = state();
  if (registry.rehydratedParents.has(parentPiSessionId)) return;
  registry.rehydratedParents.add(parentPiSessionId);
  const live = registry.byParent.get(parentPiSessionId) ?? [];
  const known = new Set(live.map((run) => run.piSessionId).filter(Boolean));
  for (const child of listSubagentChildren(parentPiSessionId)) {
    registry.childPiSessionIds.add(child.childSessionId);
    if (known.has(child.childSessionId)) continue;
    const runId = child.runId ?? child.childSessionId.slice(0, 8);
    live.push({
      id: runId,
      parentPiSessionId,
      name: child.subagentName ?? "Subagent",
      task: child.task ?? "",
      piSessionId: child.childSessionId,
      runtimeSessionId: `${SUBAGENT_SESSION_PREFIX}${parentPiSessionId}:${runId}`,
      cwd: child.cwd ?? "",
      status: "done",
      startedAt: child.updatedAt ?? new Date(0).toISOString(),
      finishedAt: child.updatedAt,
    });
  }
  // Oldest first, matching insertion order for live runs.
  live.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  registry.byParent.set(parentPiSessionId, live);
}

export function listSubagents(parentPiSessionId: string): SubagentRun[] {
  rehydrateParent(parentPiSessionId);
  return state().byParent.get(parentPiSessionId) ?? [];
}

/** Scoped lookup: a run is only reachable through the parent that spawned it. */
export function findSubagent(parentPiSessionId: string, runId: string): SubagentRun | null {
  const target = runId.trim();
  return listSubagents(parentPiSessionId).find((run) => run.id === target) ?? null;
}

function findParentRuntime(parentPiSessionId: string) {
  return piRuntimeManager
    .listSessions()
    .find(({ session }) => session.status.piSessionId === parentPiSessionId);
}

/** The child's live runtime entry, if this runtime still holds one. */
function findChildRuntime(run: SubagentRun) {
  return piRuntimeManager.findSessionForLookup(run.runtimeSessionId, run.piSessionId);
}

function taskPrompt(name: string, task: string): string {
  return [
    `You are "${name}", a subagent completing one task for a parent agent session.`,
    "Work independently with the tools you have. When finished, end with a clear,",
    "self-contained final report — it is the only thing the parent will see.",
    "",
    task,
  ].join("\n");
}

/** Cap the report the parent sees, but say so rather than cutting silently —
 *  the full text stays readable in the subagent's own session. */
function clampReport(text: string): string {
  if (text.length <= MAX_RESULT_CHARS) return text;
  const dropped = text.length - MAX_RESULT_CHARS;
  return `${text.slice(0, MAX_RESULT_CHARS)}\n\n[truncated — ${dropped} more characters; open the subagent's session for the rest]`;
}

/** Whatever the child has written to its transcript so far. Readable mid-run,
 *  so a still-working subagent can be inspected rather than only awaited. */
export function subagentReport(run: SubagentRun): LastAssistantResult {
  if (!run.piSessionId) return { text: "", error: null };
  const result = lastAssistantResult(run.cwd, run.piSessionId);
  // Aborting the child writes "Request was aborted" into its transcript as an
  // assistant error; adopting it would paint a deliberate stop as a failure.
  return { text: clampReport(result.text), error: run.status === "cancelled" ? null : result.error };
}

/** True while this runtime still has the child streaming. */
export function subagentIsActive(run: SubagentRun): boolean {
  return findChildRuntime(run)?.session.status.active === true;
}

/** Terminal states are write-once: the first writer wins, so a prompt that
 *  unblocks because stopSubagent aborted it cannot re-report itself as done. */
function settle(run: SubagentRun, status: SubagentStatus, error?: string): void {
  if (run.status !== "running") return;
  run.status = status;
  if (error) run.error = error;
  run.finishedAt = new Date().toISOString();
}

/** Record the child's pi session id as soon as it exists — before the prompt,
 *  not after it returns. That is what makes a running child reachable: the UI
 *  can open it, and the no-nesting guard sees it in childPiSessionIds. */
async function adoptChildSession(run: SubagentRun, piSessionId: string | null): Promise<void> {
  if (!piSessionId || run.piSessionId === piSessionId) return;
  run.piSessionId = piSessionId;
  state().childPiSessionIds.add(piSessionId);
  await setSubagentLink(piSessionId, run.parentPiSessionId, run.name, {
    runId: run.id,
    cwd: run.cwd,
    task: run.task,
  }).catch(() => undefined);
}

/** Stop a child this session spawned. Settling the run first frees its slot
 *  against the concurrency cap immediately, so the parent can spawn a
 *  replacement without waiting on the child's teardown. */
export async function stopSubagent(parentPiSessionId: string, runId: string): Promise<SubagentRun> {
  const run = findSubagent(parentPiSessionId, runId);
  if (!run) throw new Error(`No subagent "${runId}" was spawned by this session.`);
  if (run.status !== "running") return run;
  settle(run, "cancelled");
  const child = findChildRuntime(run);
  if (child) {
    await child.session.abort().catch(() => undefined);
    await child.session.stop().catch(() => undefined);
  }
  return run;
}

function stoppedResult(
  run: SubagentRun,
  text: string,
): { piSessionId: string | null; result: string } {
  const partial = text ? `\n\nPartial work so far:\n${text}` : "";
  return {
    piSessionId: run.piSessionId,
    result: `Subagent "${run.name}" was stopped before it reported.${partial}`,
  };
}

type SubagentSession = ReturnType<typeof piRuntimeManager.getSessionForLookup>["session"];

/** Drive an already-started child's prompt to completion and settle its run.
 *  Runs detached from any HTTP response — the spawn call has long since
 *  answered by the time a real task finishes. */
async function completeSubagent(
  run: SubagentRun,
  session: SubagentSession,
): Promise<{ piSessionId: string | null; result: string }> {
  try {
    await session.prompt(taskPrompt(run.name, run.task), () => {});
    const status = session.status;
    await adoptChildSession(run, status.piSessionId);
    const report = subagentReport(run);
    void session.stop().catch(() => undefined);
    // A stop that landed mid-prompt already settled the run; report the partial
    // work rather than overwriting the cancellation with done/error.
    if (run.status === "cancelled") return stoppedResult(run, report.text);
    const failure = status.lastError ?? report.error;
    if (failure) {
      settle(run, "error", failure);
      throw new Error(`Subagent "${run.name}" failed: ${failure}`);
    }
    settle(run, "done");
    return {
      piSessionId: run.piSessionId,
      result: report.text || "(the subagent produced no final text)",
    };
  } catch (error) {
    if (run.status === "cancelled") return stoppedResult(run, subagentReport(run).text);
    settle(run, "error", error instanceof Error ? error.message : "Subagent run failed");
    throw error;
  }
}

/**
 * Vet, register, and start one child, returning as soon as it is prompting.
 *
 * `completion` settles when the child's whole run does. The spawn/await split
 * exists because the HTTP hops between the tool and this module enforce
 * Node's ~5-minute response-header timeout: awaiting completion inside the
 * request made every longer run die with a bogus "runtime unreachable" while
 * the child worked on. Callers either await `completion` (short waits) or
 * respond with the run id and let the tool poll status.
 */
export async function spawnSubagent(input: {
  parentPiSessionId: string;
  name: string;
  task: string;
  modelId?: string;
}): Promise<{ run: SubagentRun; completion: Promise<{ piSessionId: string | null; result: string }> }> {
  const registry = state();
  const { parentPiSessionId } = input;

  if (
    registry.childPiSessionIds.has(parentPiSessionId) ||
    sessionSubagentLink(parentPiSessionId) !== null
  ) {
    throw new Error("Subagents cannot spawn their own subagents.");
  }
  const parent = findParentRuntime(parentPiSessionId);
  if (!parent) {
    throw new Error("No running session found for this conversation.");
  }
  if (parent.sessionId.startsWith(SUBAGENT_SESSION_PREFIX)) {
    throw new Error("Subagents cannot spawn their own subagents.");
  }
  const running = listSubagents(parentPiSessionId).filter((run) => run.status === "running");
  if (running.length >= MAX_CONCURRENT_PER_PARENT) {
    throw new Error(
      `Too many subagents already running (${running.length}). Wait for one to finish, or stop one with subagent_stop.`,
    );
  }

  const siblingCount = listSubagents(parentPiSessionId).length;
  const runId = randomUUID().slice(0, 8);
  const cwd = parent.session.status.cwd;
  const run: SubagentRun = {
    id: runId,
    parentPiSessionId,
    name: input.name.trim() || NICKNAMES[siblingCount % NICKNAMES.length],
    task: input.task,
    piSessionId: null,
    runtimeSessionId: `${SUBAGENT_SESSION_PREFIX}${parentPiSessionId}:${runId}`,
    cwd,
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  const runs = registry.byParent.get(parentPiSessionId) ?? [];
  runs.push(run);
  registry.byParent.set(parentPiSessionId, runs);

  const modelId = input.modelId?.trim() || parent.session.status.modelId;

  try {
    const { session } = piRuntimeManager.getSessionForLookup(run.runtimeSessionId, null);
    await session.ensureStarted(modelId, cwd || undefined, null, {});
    run.cwd = session.status.cwd || cwd;
    await adoptChildSession(run, session.status.piSessionId);
    return { run, completion: completeSubagent(run, session) };
  } catch (error) {
    settle(run, "error", error instanceof Error ? error.message : "Subagent run failed");
    throw error;
  }
}

export async function runSubagent(input: {
  parentPiSessionId: string;
  name: string;
  task: string;
  modelId?: string;
}): Promise<{ piSessionId: string | null; result: string }> {
  const { completion } = await spawnSubagent(input);
  return completion;
}
