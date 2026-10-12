import {
  claimDueAutomation,
  listAutomations,
  nextRunAt,
  patchAutomation,
  recordAutomationRun,
  withAutomationRunLock,
  type Automation,
} from "./automations-store";
import { getGlobalSingleton } from "./instances";
import { piRuntimeManager } from "./pi-runtime";
import { lastAssistantResult } from "./session-text";
import { listProjectsFromStore } from "./projects-store";
import { refreshPiModels } from "./pi-runtime-models";
import { findSessionFile } from "./sessions-store";

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

/**
 * `resuming` suppresses the previous-run preamble: the run is continuing the
 * same thread, so that summary is already a few messages up and repeating it
 * every run would grow the transcript with its own echo.
 */
function runPrompt(automation: Automation, resuming: boolean): string {
  const preamble =
    !resuming && automation.lastRun?.summary
      ? `Previous run summary (context, may be stale):\n${automation.lastRun.summary}\n\n---\n\n`
      : "";
  return `${preamble}${automation.prompt}`;
}

export function automationRunError(lastError: string | null, summary: string): string | null {
  if (lastError) return lastError;
  return summary.trim() ? null : "Automation completed without an assistant response.";
}

/**
 * The model an automation should actually run on.
 *
 * A schedule outlives the model it was written against: the configured model
 * gets evicted, a different one is serving, and the run fails at 3am on a
 * machine nobody is watching. If the configured model is not live, any live
 * model is a better outcome than no run at all. The configured id is kept when
 * nothing is live, so the failure still names the model the user chose.
 */
async function runnableModelId(configured: string): Promise<string> {
  try {
    const { models } = await refreshPiModels();
    // Reachable, not "active". `active` means a controller reports the weights
    // loaded right now, and it is hardcoded false for every cloud and
    // pi-provider model (provider-hub.ts, pi-runtime-models.ts) — testing it
    // would rip a working cloud model out of an automation and replace it with
    // whatever happened to be loaded locally. A model that appears in the list
    // at all can be run.
    if (models.some((model) => model.id === configured)) return configured;
    // Genuinely gone: prefer something a controller has loaded, else anything.
    const fallback = models.find((model) => model.active) ?? models[0];
    if (!fallback) return configured;
    console.warn(`[automation] ${configured} is unavailable; running on ${fallback.id} instead`);
    return fallback.id;
  } catch {
    return configured;
  }
}

/**
 * Where the transcript of a targeted session lives.
 *
 * Session files are indexed by working directory, and an automation can point
 * at a thread from another project, so the automation's own directory is only
 * the first guess — every registered project is a candidate.
 */
function findTargetSessionCwd(automation: Automation, targetSessionId: string): string | null {
  const candidates = [automation.cwd, ...listProjectsFromStore().map((project) => project.path)];
  for (const candidate of new Set(candidates.map((cwd) => cwd.trim()).filter(Boolean))) {
    try {
      if (findSessionFile(candidate, targetSessionId)) return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

type RunTarget = {
  /** The pi session to resume, or null to open a fresh one. */
  piSessionId: string | null;
  cwd: string | undefined;
  /** Runtime session that owns the turn. */
  runtimeSessionId: string;
  /** True when an already-running runtime session was reused — its lifetime
   *  belongs to whoever started it (the chat pane), so this run must not stop
   *  it or overwrite the tools it was started with. */
  adopted: boolean;
  /** Explains a target that could not be honoured, for the run summary. */
  note: string;
};

/**
 * Resolve the session an automation run happens in.
 *
 * A configured target that has since been deleted must not fail the run — the
 * work still matters — so it degrades to a fresh session and says so in the
 * summary the user reads.
 */
function resolveRunTarget(automation: Automation): RunTarget {
  const fresh = `automation:${automation.id}:${Date.now()}`;
  const target = automation.targetSessionId?.trim() ?? "";
  const cwd = target ? findTargetSessionCwd(automation, target) : null;
  if (!target || !cwd) {
    return {
      piSessionId: null,
      cwd: automation.cwd || undefined,
      runtimeSessionId: fresh,
      adopted: false,
      note: target
        ? `Session ${target} no longer exists on this machine — this run used a fresh session instead.`
        : "",
    };
  }
  // Reuse the live runtime session when the thread is already open, so two
  // runtimes never append to the same transcript at once.
  const live = piRuntimeManager.findSessionForLookup(fresh, target);
  return {
    piSessionId: target,
    cwd,
    runtimeSessionId: live?.sessionId ?? fresh,
    adopted: Boolean(live),
    note: "",
  };
}

function runSummary(note: string, text: string): string {
  if (!note) return text;
  return text ? `${note}\n\n${text}` : note;
}

export async function runAutomationNow(
  id: string,
  opts: { requireDue?: boolean } = {},
): Promise<Automation | null> {
  const scheduler = state();
  if (scheduler.running.has(id)) return null;
  scheduler.running.add(id);
  try {
    return await withAutomationRunLock(id, async () => {
      const claimed = await claimDueAutomation(id, { requireDue: opts.requireDue === true });
      if (!claimed) return null;
      const target = resolveRunTarget(claimed);
      try {
        const { session } = piRuntimeManager.getSessionForLookup(
          target.runtimeSessionId,
          target.piSessionId,
        );
        const modelId = await runnableModelId(claimed.modelId);
        await session.ensureStarted(
          modelId,
          target.cwd,
          target.piSessionId,
          target.adopted ? undefined : {},
        );
        await session.prompt(runPrompt(claimed, target.piSessionId !== null), () => {});
        const status = session.status;
        const piSessionId = status.piSessionId;
        const result = piSessionId
          ? lastAssistantResult(status.cwd, piSessionId)
          : { text: "", error: null };
        const error = automationRunError(status.lastError ?? result.error, result.text);
        const projectId =
          listProjectsFromStore().find((project) => project.path === status.cwd)?.id ?? null;
        if (!target.adopted) void session.stop().catch(() => undefined);
        return await recordAutomationRun(id, {
          at: new Date().toISOString(),
          piSessionId,
          cwd: status.cwd,
          projectId,
          outcome: error ? "error" : "ok",
          summary: runSummary(target.note, result.text),
          ...(error ? { error } : {}),
        });
      } catch (error) {
        return await recordAutomationRun(id, {
          at: new Date().toISOString(),
          piSessionId: null,
          cwd: claimed.cwd,
          projectId: null,
          outcome: "error",
          summary: "",
          error: error instanceof Error ? error.message : "Automation run failed",
        });
      }
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
    if (new Date(automation.nextRunAt) <= now) {
      void runAutomationNow(automation.id, { requireDue: true });
    }
  }
}

export function startAutomationScheduler(): void {
  const scheduler = state();
  if (scheduler.timer) return;
  scheduler.timer = setInterval(() => {
    void tick();
  }, TICK_MS);
  void tick();
}
