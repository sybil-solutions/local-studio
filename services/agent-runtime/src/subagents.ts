//
// Subagents: child pi sessions a parent session's model spawns through the
// `subagent` tool. Each subagent runs headless in this runtime with its own
// context and canonical session file (so the UI can open it like any other
// session), reports its final text back as the tool result, and shows up in
// the parent's chips via the registry here.
//

import { randomUUID } from "node:crypto";
import { getGlobalSingleton } from "./instances";
import { piRuntimeManager } from "./pi-runtime";
import { lastAssistantText } from "./session-text";

const MAX_CONCURRENT_PER_PARENT = 4;
const MAX_RESULT_CHARS = 8000;
const SUBAGENT_SESSION_PREFIX = "subagent:";

export type SubagentRun = {
  id: string;
  parentPiSessionId: string;
  name: string;
  task: string;
  piSessionId: string | null;
  status: "running" | "done" | "error";
  startedAt: string;
  finishedAt: string | null;
  error?: string;
};

type SubagentState = {
  /** parent pi session id -> runs, newest last */
  byParent: Map<string, SubagentRun[]>;
  /** pi session ids that ARE subagents — they may not spawn their own */
  childPiSessionIds: Set<string>;
};

function state(): SubagentState {
  return getGlobalSingleton("subagentRegistry", () => ({
    byParent: new Map<string, SubagentRun[]>(),
    childPiSessionIds: new Set<string>(),
  }));
}

export function listSubagents(parentPiSessionId: string): SubagentRun[] {
  return state().byParent.get(parentPiSessionId) ?? [];
}

function findParentRuntime(parentPiSessionId: string) {
  return piRuntimeManager
    .listSessions()
    .find(({ session }) => session.status.piSessionId === parentPiSessionId);
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

export async function runSubagent(input: {
  parentPiSessionId: string;
  name: string;
  task: string;
  modelId?: string;
}): Promise<{ piSessionId: string | null; result: string }> {
  const registry = state();
  const { parentPiSessionId } = input;

  if (registry.childPiSessionIds.has(parentPiSessionId)) {
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
      `Too many subagents already running (${running.length}). Wait for one to finish.`,
    );
  }

  const run: SubagentRun = {
    id: randomUUID().slice(0, 8),
    parentPiSessionId,
    name: input.name.trim() || "Subagent",
    task: input.task,
    piSessionId: null,
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  const runs = registry.byParent.get(parentPiSessionId) ?? [];
  runs.push(run);
  registry.byParent.set(parentPiSessionId, runs);

  const modelId = input.modelId?.trim() || parent.session.status.modelId;
  const cwd = parent.session.status.cwd;
  const runtimeSessionId = `${SUBAGENT_SESSION_PREFIX}${parentPiSessionId}:${run.id}`;

  try {
    const { session } = piRuntimeManager.getSessionForLookup(runtimeSessionId, null);
    await session.ensureStarted(modelId, cwd || undefined, null, {});
    await session.prompt(taskPrompt(run.name, input.task), () => {});
    const status = session.status;
    run.piSessionId = status.piSessionId;
    if (status.piSessionId) registry.childPiSessionIds.add(status.piSessionId);
    const text = status.piSessionId ? lastAssistantText(status.cwd, status.piSessionId) : "";
    void session.stop().catch(() => undefined);
    if (status.lastError) {
      run.status = "error";
      run.error = status.lastError;
      run.finishedAt = new Date().toISOString();
      throw new Error(`Subagent "${run.name}" failed: ${status.lastError}`);
    }
    run.status = "done";
    run.finishedAt = new Date().toISOString();
    return {
      piSessionId: status.piSessionId,
      result: text.slice(0, MAX_RESULT_CHARS) || "(the subagent produced no final text)",
    };
  } catch (error) {
    if (run.status === "running") {
      run.status = "error";
      run.error = error instanceof Error ? error.message : "Subagent run failed";
      run.finishedAt = new Date().toISOString();
    }
    throw error;
  }
}
