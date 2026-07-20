//
// Automation scheduler: a 30s tick in the agent-runtime process that fires
// due automations as headless turns. Runs are ordinary pi sessions; results
// persist on the automation record (last run + unread) for the Scheduled UI.
//

import {
  getAutomation,
  listAutomations,
  nextRunAt,
  patchAutomation,
  type Automation,
} from "./automations-store";
import { getGlobalSingleton } from "./instances";
import { piRuntimeManager } from "./pi-runtime";
import { lastAssistantText } from "./session-text";

const TICK_MS = 30_000;

type SchedulerState = {
  timer: ReturnType<typeof setInterval> | null;
  running: Set<string>;
};

function state(): SchedulerState {
  return getGlobalSingleton("automationScheduler", () => ({
    timer: null,
    running: new Set<string>(),
  }));
}

function runPrompt(automation: Automation): string {
  const preamble = automation.lastRun?.summary
    ? `Previous run summary (context, may be stale):\n${automation.lastRun.summary}\n\n---\n\n`
    : "";
  return `${preamble}${automation.prompt}`;
}

export async function runAutomationNow(id: string): Promise<Automation | null> {
  const scheduler = state();
  const automation = await getAutomation(id);
  if (!automation || scheduler.running.has(id)) return automation;
  scheduler.running.add(id);
  const runtimeSessionId = `automation:${id}:${Date.now()}`;
  try {
    const { session } = piRuntimeManager.getSessionForLookup(runtimeSessionId, null);
    await session.ensureStarted(automation.modelId, automation.cwd || undefined, null, {});
    await session.prompt(runPrompt(automation), () => {});
    const status = session.status;
    const piSessionId = status.piSessionId;
    const summary = piSessionId ? lastAssistantText(status.cwd, piSessionId) : "";
    void session.stop().catch(() => undefined);
    return await patchAutomation(id, {
      unread: true,
      lastRun: {
        at: new Date().toISOString(),
        piSessionId,
        outcome: status.lastError ? "error" : "ok",
        summary,
        ...(status.lastError ? { error: status.lastError } : {}),
      },
      nextRunAt: nextRunAt(automation.schedule, new Date()).toISOString(),
    });
  } catch (error) {
    return await patchAutomation(id, {
      unread: true,
      lastRun: {
        at: new Date().toISOString(),
        piSessionId: null,
        outcome: "error",
        summary: "",
        error: error instanceof Error ? error.message : "Automation run failed",
      },
      nextRunAt: nextRunAt(automation.schedule, new Date()).toISOString(),
    });
  } finally {
    scheduler.running.delete(id);
  }
}

async function tick(): Promise<void> {
  const now = new Date();
  let automations: Automation[];
  try {
    automations = await listAutomations();
  } catch {
    return;
  }
  for (const automation of automations) {
    if (automation.status !== "active") continue;
    if (!automation.nextRunAt) {
      await patchAutomation(automation.id, {
        nextRunAt: nextRunAt(automation.schedule, now).toISOString(),
      }).catch(() => undefined);
      continue;
    }
    // Missed occurrences (machine asleep) are skipped, Codex-style: one run
    // fires now and the schedule advances from the present.
    if (new Date(automation.nextRunAt) <= now) {
      void runAutomationNow(automation.id);
    }
  }
}

/** Start the tick loop. Idempotent; called from the runtime server boot. */
export function startAutomationScheduler(): void {
  const scheduler = state();
  if (scheduler.timer) return;
  scheduler.timer = setInterval(() => {
    void tick();
  }, TICK_MS);
  void tick();
}
