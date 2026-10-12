import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { attachGoalDriver, markGoalTurnAborted } from "../src/goal-driver";
import { readGoal, writeGoal } from "../src/goals-store";
import type { LoggedPiEvent, PiAgentSession } from "../src/pi-runtime-types";

const PI_SESSION_ID = "goal-driver-test-session";
const temporaryRoots: string[] = [];
const originalDataDir = process.env.LOCAL_STUDIO_DATA_DIR;

beforeEach(() => {
  const dataDir = mkdtempSync(path.join(tmpdir(), "goal-driver-"));
  temporaryRoots.push(dataDir);
  process.env.LOCAL_STUDIO_DATA_DIR = dataDir;
});

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
  else process.env.LOCAL_STUDIO_DATA_DIR = originalDataDir;
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

type Harness = {
  session: PiAgentSession;
  emit: (event: Record<string, unknown>) => void;
  prompts: string[];
};

function harness(): Harness {
  const listeners: Array<(logged: LoggedPiEvent) => void> = [];
  const prompts: string[] = [];
  let seq = 0;
  const session = {
    status: {
      running: false,
      active: false,
      modelId: "test",
      cwd: "/tmp",
      piSessionId: PI_SESSION_ID,
      agentDir: "/tmp",
      eventSeq: 0,
      lastError: null,
      contextUsage: null,
    },
    onLoggedEvent(listener: (logged: LoggedPiEvent) => void) {
      listeners.push(listener);
      return () => undefined;
    },
    async prompt(message: string) {
      prompts.push(message);
    },
  } as unknown as PiAgentSession;
  attachGoalDriver(session);
  return {
    session,
    prompts,
    emit: (event) => {
      seq += 1;
      for (const listener of listeners) listener({ seq, event, timestamp: "" });
    },
  };
}

const assistantSays = (text: string) => ({
  type: "message",
  message: { role: "assistant", content: [{ type: "text", text }] },
});

/**
 * The driver settles asynchronously off the event stream, so wait for the goal
 * record to stop changing rather than for a fixed delay. A single 30ms sleep
 * raced the driver on loaded CI runners: the assertions ran while the turn was
 * still being processed, so the suite failed intermittently on CI while
 * passing on every developer machine.
 */
const flush = async (): Promise<void> => {
  const deadline = Date.now() + 2_000;
  let previous = JSON.stringify(await readGoal(PI_SESSION_ID));
  let stableReads = 0;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    const current = JSON.stringify(await readGoal(PI_SESSION_ID));
    stableReads = current === previous ? stableReads + 1 : 0;
    previous = current;
    if (stableReads >= 3) return;
  }
};

async function setGoal(patch: Parameters<typeof writeGoal>[1] = {}) {
  await writeGoal(PI_SESSION_ID, {
    objective: "ship the release",
    status: "active",
    resetProgress: true,
    ...patch,
  });
}

describe("a settled turn advances the goal", () => {
  test("an ordinary turn counts and leaves the goal active", async () => {
    const { emit } = harness();
    await setGoal();
    emit({ type: "agent_start" });
    emit(assistantSays("Rebuilt the bundle."));
    emit({ type: "agent_settled" });
    await flush();
    const goal = await readGoal(PI_SESSION_ID);
    expect(goal?.status).toBe("active");
    expect(goal?.turnsUsed).toBe(1);
  });

  test("the completion sentinel from THIS turn settles the goal", async () => {
    const { emit } = harness();
    await setGoal();
    emit({ type: "agent_start" });
    emit(assistantSays("All green.\nGOAL_COMPLETE"));
    emit({ type: "agent_settled" });
    await flush();
    expect((await readGoal(PI_SESSION_ID))?.status).toBe("complete");
  });

  test("a turn that produced no text cannot inherit the previous turn's sentinel", async () => {
    const { emit } = harness();
    await setGoal();
    emit({ type: "agent_start" });
    emit(assistantSays("All green.\nGOAL_COMPLETE"));
    emit({ type: "agent_settled" });
    await flush();
    // The goal is re-aimed; the transcript still ends in GOAL_COMPLETE.
    await setGoal({ objective: "now do the next thing" });
    emit({ type: "agent_start" });
    emit({ type: "tool_execution_start" });
    emit({ type: "agent_settled" });
    await flush();
    const goal = await readGoal(PI_SESSION_ID);
    expect(goal?.status).toBe("active");
    expect(goal?.turnsUsed).toBe(1);
  });

  test("a spent turn budget stops the pursuit", async () => {
    const { emit } = harness();
    await setGoal({ turnBudget: 1 });
    emit({ type: "agent_start" });
    emit(assistantSays("Working."));
    emit({ type: "agent_settled" });
    await flush();
    const goal = await readGoal(PI_SESSION_ID);
    expect(goal?.status).toBe("budget_limited");
    expect(goal?.turnsUsed).toBe(1);
  });

  test("pursuit time is banked per run, not measured from createdAt", async () => {
    const { emit } = harness();
    await setGoal();
    emit({ type: "agent_start" });
    await flush();
    expect((await readGoal(PI_SESSION_ID))?.activeRunStartedAt).not.toBeNull();
    emit({ type: "agent_settled" });
    await flush();
    const goal = await readGoal(PI_SESSION_ID);
    expect(goal?.activeRunStartedAt).toBeNull();
    expect(goal?.timeUsedSeconds).toBeGreaterThanOrEqual(0);
  });
});

describe("a stopped pursuit says so", () => {
  test("Stop pauses the goal instead of re-prompting two seconds later", async () => {
    const { session, emit, prompts } = harness();
    await setGoal();
    emit({ type: "agent_start" });
    // The SDK emits agent_settled from a `finally`, so an abort looks exactly
    // like a completed turn unless the abort path marks it first.
    markGoalTurnAborted(session);
    emit({ type: "agent_settled" });
    await flush();
    expect((await readGoal(PI_SESSION_ID))?.status).toBe("paused");
    await new Promise((resolve) => setTimeout(resolve, 2200));
    expect(prompts).toHaveLength(0);
  });

  test("a runtime error pauses rather than spinning", async () => {
    const { session, emit } = harness();
    await setGoal();
    emit({ type: "agent_start" });
    (session.status as { lastError: string | null }).lastError = "model unreachable";
    emit({ type: "agent_settled" });
    await flush();
    expect((await readGoal(PI_SESSION_ID))?.status).toBe("paused");
  });

  test("a continuation that made no tool call parks the goal instead of silently giving up", async () => {
    const { emit, prompts } = harness();
    await setGoal();
    emit({ type: "agent_start" });
    emit(assistantSays("Working."));
    emit({ type: "agent_settled" });
    await flush();
    await new Promise((resolve) => setTimeout(resolve, 2200));
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("ship the release");

    // The continuation replies with words and no tool call — the spin case.
    emit(assistantSays("I think we are nearly there."));
    emit({ type: "agent_settled" });
    await flush();
    // The status is PERSISTED, so the UI stops claiming the goal is being
    // pursued and offers Resume, rather than the driver stopping in memory
    // while the stored status still reads "active".
    expect((await readGoal(PI_SESSION_ID))?.status).toBe("paused");
  });
});
