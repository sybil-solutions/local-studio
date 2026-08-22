// Automations (Scheduled) tools for Local Studio.
//
// Gives the agent the same control over automations the Automations tab has:
// list, read one with its run history, create, update, pause/resume, run now
// and delete. An automation is a saved prompt the runtime re-runs on a
// cron-like schedule in its own fresh session.
//
// Every tool here calls the SAME endpoints the tab calls
// (/api/agent/automations…, proxied verbatim to the runtime's automations
// store). There is deliberately no state in this file: if a tool and the tab
// ever showed different automations, that would mean a second store had been
// introduced. Calls proxy through the frontend like the subagents/connectors
// bridges, so this file stays a plain pi extension with no runtime imports.
//
// The record shape mirrors services/agent-runtime automations-store.ts
// (Automation): name, prompt, modelId, cwd, schedule{interval|daily|weekly},
// status, nextRunAt, lastRun and runs[].

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { failure, frontendBase, textResult, withTimeout, type ToolResult } from "./bridge.ts";
import { Type } from "./schema.ts";

const FRONTEND_BASE = frontendBase();
const CALL_TIMEOUT_MS = 30_000;
// "Run now" is not a store write: the endpoint runs the whole automation turn
// in a fresh session and only answers once the result has been recorded. On the
// 30s call budget every real run aborted here while the runtime kept going, so
// it gets the subagent-sized budget instead.
const RUN_TIMEOUT_MS = 15 * 60_000;
const LAST_RUN_SUMMARY_CHARS = 1200;
const HISTORY_SUMMARY_CHARS = 240;

// ─── Schedule shapes (mirror shared/agent/automation.ts) ────────────────────

type IntervalSchedule = { kind: "interval"; minutes: number };
type DailySchedule = { kind: "daily"; time: string; weekdaysOnly?: boolean };
type WeeklySchedule = { kind: "weekly"; day: number; time: string };
export type NormalizedSchedule = IntervalSchedule | DailySchedule | WeeklySchedule;

type ScheduleArg = {
  kind?: unknown;
  minutes?: unknown;
  time?: unknown;
  day?: unknown;
  weekdaysOnly?: unknown;
};

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const SCHEDULE_DOC =
  "Schedule format — one of: " +
  "{kind:'interval', minutes:N} runs every N minutes (N >= 1); " +
  "{kind:'daily', time:'HH:MM'} runs every day at that 24-hour local clock time, " +
  "add weekdaysOnly:true to skip Saturday and Sunday; " +
  "{kind:'weekly', day:D, time:'HH:MM'} runs once a week, day 0 = Sunday … 6 = Saturday.";

function isValidTime(value: unknown): value is string {
  return typeof value === "string" && /^([01]?\d|2[0-3]):[0-5]\d$/.test(value.trim());
}

/** Validate the agent-supplied schedule into the store's shape, or explain what
 *  is wrong. The store silently rewrites anything it cannot parse to "daily at
 *  08:00", so every write path must pass through here first — otherwise a typo
 *  reschedules the automation instead of failing. Kept pure so the
 *  normalization is checkable without HTTP. */
export function normalizeScheduleArg(
  input: ScheduleArg | undefined,
): { ok: true; schedule: NormalizedSchedule } | { ok: false; error: string } {
  if (!input || typeof input !== "object") {
    return { ok: false, error: `schedule is required (an object with a 'kind'). ${SCHEDULE_DOC}` };
  }
  const kind = input.kind;
  if (kind === "interval") {
    const minutes = typeof input.minutes === "number" ? Math.round(input.minutes) : NaN;
    if (!Number.isFinite(minutes) || minutes < 1) {
      return { ok: false, error: "interval schedule needs 'minutes' >= 1." };
    }
    return { ok: true, schedule: { kind: "interval", minutes } };
  }
  if (kind === "daily") {
    if (!isValidTime(input.time)) {
      return { ok: false, error: "daily schedule needs 'time' as 'HH:MM' (24h)." };
    }
    return {
      ok: true,
      schedule: {
        kind: "daily",
        time: (input.time as string).trim(),
        ...(input.weekdaysOnly === true ? { weekdaysOnly: true } : {}),
      },
    };
  }
  if (kind === "weekly") {
    const day = typeof input.day === "number" ? Math.round(input.day) : NaN;
    if (!Number.isInteger(day) || day < 0 || day > 6) {
      return { ok: false, error: "weekly schedule needs 'day' 0-6 (0 = Sunday)." };
    }
    if (!isValidTime(input.time)) {
      return { ok: false, error: "weekly schedule needs 'time' as 'HH:MM' (24h)." };
    }
    return { ok: true, schedule: { kind: "weekly", day, time: (input.time as string).trim() } };
  }
  return {
    ok: false,
    error: `schedule.kind must be 'interval', 'daily' or 'weekly'. ${SCHEDULE_DOC}`,
  };
}

/** One-line human description of a schedule, for list output. */
export function describeSchedule(schedule: NormalizedSchedule): string {
  if (schedule.kind === "interval") return `every ${schedule.minutes} min`;
  if (schedule.kind === "daily") {
    return `daily at ${schedule.time}${schedule.weekdaysOnly ? " (weekdays)" : ""}`;
  }
  return `weekly on ${WEEKDAY_NAMES[schedule.day] ?? `day ${schedule.day}`} at ${schedule.time}`;
}

const scheduleParameter = Type.Object(
  {
    kind: Type.Union([Type.Literal("interval"), Type.Literal("daily"), Type.Literal("weekly")], {
      description: "interval = every N minutes; daily/weekly = at a clock time",
    }),
    minutes: Type.Optional(Type.Number({ description: "interval only: minutes, >= 1" })),
    time: Type.Optional(Type.String({ description: "daily/weekly only: 'HH:MM' 24h local time" })),
    day: Type.Optional(Type.Number({ description: "weekly only: 0-6, 0 = Sunday" })),
    weekdaysOnly: Type.Optional(Type.Boolean({ description: "daily only: skip Saturday/Sunday" })),
  },
  { description: `When to run. ${SCHEDULE_DOC}` },
);

// ─── HTTP helpers ───────────────────────────────────────────────────────────

type HttpReply = { ok: boolean; status: number; body: unknown };

async function httpJson(
  path: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
  timeoutMs: number = CALL_TIMEOUT_MS,
): Promise<HttpReply> {
  const bounded = withTimeout(signal, timeoutMs);
  try {
    const response = await fetch(`${FRONTEND_BASE}${path}`, {
      ...init,
      signal: bounded.signal,
    });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { ok: response.ok, status: response.status, body };
  } finally {
    bounded.done();
  }
}

function errorText(body: unknown, status: number): string {
  if (body && typeof body === "object" && "error" in body) {
    const message = (body as { error?: unknown }).error;
    if (typeof message === "string") return message;
  }
  return `HTTP ${status}`;
}

function automationPath(id: string, suffix = ""): string {
  return `/api/agent/automations/${encodeURIComponent(id)}${suffix}`;
}

/** Every tool body is "do one HTTP call, format the reply"; the try/catch is the
 *  only thing standing between a dropped runtime and an unhandled rejection. */
async function guarded(label: string, run: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(`Failed to ${label}: ${message}`);
  }
}

/** Resolve the model an automation should run under: explicit arg, else the
 *  current session's model (injected by pi-runtime), else the first available. */
async function resolveModelId(
  explicit: string | undefined,
  signal: AbortSignal | undefined,
): Promise<string | null> {
  const trimmed = explicit?.trim();
  if (trimmed) return trimmed;
  const envModel = process.env.LOCAL_STUDIO_MODEL_ID?.trim();
  if (envModel) return envModel;
  const { ok, body } = await httpJson("/api/agent/models", { method: "GET" }, signal);
  if (!ok || !body || typeof body !== "object") return null;
  const models = (body as { models?: unknown }).models;
  if (!Array.isArray(models)) return null;
  for (const model of models) {
    if (model && typeof model === "object" && typeof (model as { id?: unknown }).id === "string") {
      const id = (model as { id: string }).id.trim();
      if (id) return id;
    }
  }
  return null;
}

/** Resolve the directory an automation should run in: explicit arg, else the
 *  current session's cwd (injected by pi-runtime), else the app default. */
function resolveCwd(explicit: string | undefined): string {
  const trimmed = explicit?.trim();
  if (trimmed) return trimmed;
  return process.env.LOCAL_STUDIO_CWD?.trim() ?? "";
}

// ─── Record formatting ──────────────────────────────────────────────────────

type RunRecord = {
  at?: unknown;
  outcome?: unknown;
  summary?: unknown;
  error?: unknown;
  piSessionId?: unknown;
};

type AutomationRecord = {
  id?: unknown;
  name?: unknown;
  status?: unknown;
  nextRunAt?: unknown;
  schedule?: unknown;
  prompt?: unknown;
  modelId?: unknown;
  cwd?: unknown;
  targetSessionId?: unknown;
  unread?: unknown;
  lastRun?: unknown;
  runs?: unknown;
  createdAt?: unknown;
};

const SESSION_DOC =
  "By default every run happens in a brand new session that remembers nothing. Pass sessionId " +
  "to run inside an existing chat instead: the run continues that thread, sees its history and " +
  "appends to it. A session id is the id of a pi session — read_automation prints the one each " +
  "past run used, and the user can read it off a chat in the app. Pass an empty string to go " +
  "back to a fresh session per run. A target that has been deleted does not fail the run: it " +
  "falls back to a fresh session and says so in that run's summary.";

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function clip(value: unknown, max: number): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}… (+${trimmed.length - max} more chars)`;
}

function asRun(value: unknown): RunRecord | null {
  return value && typeof value === "object" ? (value as RunRecord) : null;
}

function runList(record: AutomationRecord): RunRecord[] {
  if (!Array.isArray(record.runs)) return [];
  return record.runs.map(asRun).filter((run): run is RunRecord => run !== null);
}

/** describeSchedule for an already-stored (normalized) schedule object. */
function describeScheduleLoose(schedule: unknown): string {
  if (!schedule || typeof schedule !== "object") return "unknown schedule";
  const parsed = normalizeScheduleArg(schedule as ScheduleArg);
  return parsed.ok ? describeSchedule(parsed.schedule) : "unknown schedule";
}

function statusOf(record: AutomationRecord): "active" | "paused" {
  return record.status === "paused" ? "paused" : "active";
}

function describeRunOutcome(run: RunRecord | null): string {
  if (!run) return "never run";
  const outcome = run.outcome === "error" ? "failed" : "ok";
  return `last run ${outcome} at ${text(run.at, "unknown time")}`;
}

function formatAutomationLine(record: AutomationRecord): string {
  const target = text(record.targetSessionId);
  const parts = [
    describeScheduleLoose(record.schedule),
    statusOf(record),
    text(record.nextRunAt) ? `next ${record.nextRunAt}` : "no next run scheduled",
    describeRunOutcome(asRun(record.lastRun)),
  ];
  if (target) parts.push(`runs in session ${target}`);
  if (record.unread === true) parts.push("result not yet opened in the app");
  return `- ${text(record.name, "Untitled")} [${text(record.id, "(no id)")}] — ${parts.join(" · ")}`;
}

function formatRunEntry(run: RunRecord, index: number): string {
  const outcome = run.outcome === "error" ? "error" : "ok";
  const lines = [`  ${index + 1}. ${text(run.at, "unknown time")} — ${outcome}`];
  const error = text(run.error);
  if (error) lines.push(`     error: ${error}`);
  const summary = clip(run.summary, HISTORY_SUMMARY_CHARS);
  if (summary) lines.push(`     said: ${summary.replaceAll("\n", " ")}`);
  return lines.join("\n");
}

function formatLastRunBlock(run: RunRecord | null): string[] {
  if (!run) return ["last run: never — this automation has not fired yet"];
  const outcome = run.outcome === "error" ? "error" : "ok";
  const session = text(run.piSessionId);
  const lines = [
    `last run: ${outcome} at ${text(run.at, "unknown time")}${session ? ` (session ${session})` : ""}`,
  ];
  const error = text(run.error);
  if (error) lines.push(`last run error: ${error}`);
  const summary = clip(run.summary, LAST_RUN_SUMMARY_CHARS);
  lines.push(summary ? `last run said:\n${summary}` : "last run said: (no assistant output)");
  return lines;
}

function formatAutomationDetail(record: AutomationRecord, includeRuns: boolean): string {
  const runs = runList(record);
  const lines = [
    `${text(record.name, "Untitled")} [${text(record.id, "(no id)")}]`,
    `status: ${statusOf(record)}${record.unread === true ? " (latest result not yet opened in the app)" : ""}`,
    `schedule: ${describeScheduleLoose(record.schedule)}`,
    `next run: ${text(record.nextRunAt, "not scheduled")}`,
    `model: ${text(record.modelId, "(app default)")}`,
    `directory: ${text(record.cwd, "(app default)")}`,
    `runs in: ${text(record.targetSessionId) ? `session ${record.targetSessionId as string}` : "a fresh session each time"}`,
    `created: ${text(record.createdAt, "unknown")}`,
    `prompt:\n${text(record.prompt, "(empty)")}`,
    ...formatLastRunBlock(asRun(record.lastRun)),
  ];
  if (includeRuns && runs.length > 0) {
    lines.push(`run history (${runs.length} kept, newest first):`);
    lines.push(runs.map(formatRunEntry).join("\n"));
  }
  return lines.join("\n");
}

// ─── Store reads ────────────────────────────────────────────────────────────

type ListResult = { ok: true; automations: AutomationRecord[] } | { ok: false; error: string };

/** The list endpoint is the only read path — there is no GET /automations/:id —
 *  and it already returns each automation in full, run history included. */
async function fetchAutomations(signal: AbortSignal | undefined): Promise<ListResult> {
  const { ok, status, body } = await httpJson("/api/agent/automations", { method: "GET" }, signal);
  if (!ok) return { ok: false, error: errorText(body, status) };
  const automations = (body as { automations?: unknown }).automations;
  return {
    ok: true,
    automations: Array.isArray(automations) ? (automations as AutomationRecord[]) : [],
  };
}

async function fetchAutomation(
  id: string,
  signal: AbortSignal | undefined,
): Promise<{ ok: true; automation: AutomationRecord } | { ok: false; error: string }> {
  const listed = await fetchAutomations(signal);
  if (!listed.ok) return listed;
  const match = listed.automations.find((record) => record.id === id);
  if (!match) {
    return {
      ok: false,
      error: `No automation with id '${id}'. Call list_automations for the current ids.`,
    };
  }
  return { ok: true, automation: match };
}

function requireId(
  params: unknown,
  tool: string,
): { ok: true; id: string } | { ok: false; error: string } {
  const raw = (params as { id?: unknown } | undefined)?.id;
  const id = typeof raw === "string" ? raw.trim() : "";
  if (!id) return { ok: false, error: `${tool} needs an automation id (see list_automations).` };
  return { ok: true, id };
}

function patchedAutomation(body: unknown): AutomationRecord {
  const automation = (body as { automation?: unknown } | null)?.automation;
  return automation && typeof automation === "object" ? (automation as AutomationRecord) : {};
}

// ─── Tools ──────────────────────────────────────────────────────────────────

function registerReadTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "list_automations",
    label: "List automations",
    description:
      "List every scheduled automation the app knows about — the same ones shown in the " +
      "Automations tab — with its id, schedule, whether it is active or paused, when it next " +
      "runs, and how its last run ended. Call this before any other automation tool: they all " +
      "take the opaque id printed here (e.g. 'auto-1a2b3c4d'). Use read_automation for one " +
      "automation's full prompt and run history.",
    parameters: Type.Object({}),
    async execute(_id, _params, signal) {
      return guarded("list automations", async () => {
        const listed = await fetchAutomations(signal);
        if (!listed.ok) return failure(`Failed to list automations: ${listed.error}`);
        if (listed.automations.length === 0) {
          return textResult(
            "No automations are scheduled. Use schedule_automation to create one.",
            { count: 0 },
          );
        }
        const lines = listed.automations.map(formatAutomationLine);
        return textResult(`${listed.automations.length} automation(s):\n${lines.join("\n")}`, {
          count: listed.automations.length,
        });
      });
    },
  });

  pi.registerTool({
    name: "read_automation",
    label: "Read automation",
    description:
      "Read one automation in full: the exact prompt it runs, its model, working directory, the " +
      "session it runs in, schedule, next run time, and its run history — the last 20 runs with when each ran, " +
      "whether it succeeded, and what the agent reported. Use this to check whether a scheduled " +
      "job is actually doing its work (a run can succeed on schedule and still report a " +
      "failure), and to read the current prompt before editing it with update_automation.",
    parameters: Type.Object({
      id: Type.String({
        description: "The automation id from list_automations, e.g. 'auto-1a2b3c4d'.",
      }),
      includeRuns: Type.Optional(
        Type.Boolean({ description: "Include the run history. Default true." }),
      ),
    }),
    async execute(_id, params, signal) {
      const parsed = requireId(params, "read_automation");
      if (!parsed.ok) return failure(parsed.error);
      const includeRuns = (params as { includeRuns?: unknown })?.includeRuns !== false;
      return guarded("read automation", async () => {
        const found = await fetchAutomation(parsed.id, signal);
        if (!found.ok) return failure(found.error);
        return textResult(formatAutomationDetail(found.automation, includeRuns), {
          id: parsed.id,
          status: statusOf(found.automation),
          runs: runList(found.automation).length,
        });
      });
    },
  });
}

function registerWriteTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "schedule_automation",
    label: "Schedule automation",
    description:
      "Create a scheduled automation: a saved prompt the app re-runs on a schedule, by default " +
      "each time in its own fresh session that cannot see this conversation — so write a prompt " +
      "that stands on its own. Use it for recurring work the user wants to keep happening (a " +
      "morning digest, an hourly check on a service). " +
      SCHEDULE_DOC +
      " " +
      SESSION_DOC +
      " The automation runs with the current session's model and project directory unless you " +
      "pass others. Returns the new automation's id.",
    parameters: Type.Object({
      prompt: Type.String({
        description: "The standalone instruction the automation runs each time.",
      }),
      schedule: scheduleParameter,
      name: Type.Optional(Type.String({ description: "Short display name shown in the app." })),
      model: Type.Optional(
        Type.String({ description: "Model id; defaults to the current session's model." }),
      ),
      cwd: Type.Optional(
        Type.String({ description: "Working directory; defaults to the current project." }),
      ),
      sessionId: Type.Optional(
        Type.String({
          description: "Existing pi session to run inside; omit for a fresh session each run.",
        }),
      ),
    }),
    async execute(_id, params, signal) {
      const args = (params ?? {}) as {
        prompt?: string;
        schedule?: ScheduleArg;
        name?: string;
        model?: string;
        cwd?: string;
        sessionId?: string;
      };
      const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
      if (!prompt) return failure("schedule_automation needs a non-empty prompt.");
      const scheduleResult = normalizeScheduleArg(args.schedule);
      if (!scheduleResult.ok) return failure(scheduleResult.error);
      return guarded("create automation", async () => {
        const modelId = await resolveModelId(args.model, signal);
        if (!modelId) {
          return failure("No model available to run the automation. Pass a 'model' id.");
        }
        const { ok, status, body } = await httpJson(
          "/api/agent/automations",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: typeof args.name === "string" ? args.name : "",
              prompt,
              modelId,
              cwd: resolveCwd(args.cwd),
              targetSessionId: typeof args.sessionId === "string" ? args.sessionId.trim() : null,
              schedule: scheduleResult.schedule,
            }),
          },
          signal,
        );
        if (!ok) return failure(`Failed to create automation: ${errorText(body, status)}`);
        const automation = patchedAutomation(body);
        const id = text(automation.id, "(unknown)");
        const target = text(automation.targetSessionId);
        return textResult(
          `Created automation "${text(automation.name, args.name ?? "Untitled")}" [${id}] — ` +
            `${describeSchedule(scheduleResult.schedule)}. ` +
            `${target ? `Runs inside session ${target}. ` : "Each run starts a fresh session. "}` +
            `Next run ${text(automation.nextRunAt, "pending")}. ` +
            `Use run_automation_now to test it without waiting.`,
          { id, schedule: scheduleResult.schedule, modelId, targetSessionId: target || null },
        );
      });
    },
  });

  pi.registerTool({
    name: "update_automation",
    label: "Update automation",
    description:
      "Change an existing automation in place: rename it, rewrite the prompt it runs, move it to " +
      "a different schedule, model, working directory or session. Only the fields you pass " +
      "change; the rest are left exactly as they are. Always prefer this over deleting and " +
      "re-creating — a new automation loses the run history the user relies on. Read the current " +
      "values with read_automation first. " +
      SCHEDULE_DOC +
      " " +
      SESSION_DOC,
    parameters: Type.Object({
      id: Type.String({ description: "The automation id from list_automations." }),
      name: Type.Optional(Type.String({ description: "New display name." })),
      prompt: Type.Optional(Type.String({ description: "New standalone instruction to run." })),
      schedule: Type.Optional(scheduleParameter),
      model: Type.Optional(Type.String({ description: "New model id." })),
      cwd: Type.Optional(Type.String({ description: "New working directory." })),
      sessionId: Type.Optional(
        Type.String({
          description:
            "Pi session every run should continue; empty string goes back to a fresh session.",
        }),
      ),
    }),
    async execute(_id, params, signal) {
      const parsed = requireId(params, "update_automation");
      if (!parsed.ok) return failure(parsed.error);
      const args = (params ?? {}) as {
        name?: unknown;
        prompt?: unknown;
        schedule?: ScheduleArg;
        model?: unknown;
        cwd?: unknown;
        sessionId?: unknown;
      };
      const patch: Record<string, unknown> = {};
      if (typeof args.name === "string") patch.name = args.name;
      if (typeof args.prompt === "string") patch.prompt = args.prompt;
      if (typeof args.model === "string" && args.model.trim()) patch.modelId = args.model.trim();
      if (typeof args.cwd === "string") patch.cwd = args.cwd.trim();
      // An empty string is a real instruction here — "stop running in that
      // session" — so it is kept rather than filtered out like a blank cwd.
      if (typeof args.sessionId === "string") patch.targetSessionId = args.sessionId.trim() || null;
      if (args.schedule !== undefined) {
        // The store falls back to "daily at 08:00" for anything it cannot read,
        // so a malformed schedule must fail here rather than quietly move the
        // automation to 8am.
        const scheduleResult = normalizeScheduleArg(args.schedule);
        if (!scheduleResult.ok) return failure(scheduleResult.error);
        patch.schedule = scheduleResult.schedule;
      }
      if (Object.keys(patch).length === 0) {
        return failure(
          "update_automation needs at least one field to change (name, prompt, schedule, model, cwd or sessionId).",
        );
      }
      return guarded("update automation", async () => {
        const { ok, status, body } = await httpJson(
          automationPath(parsed.id),
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
          },
          signal,
        );
        if (!ok) return failure(`Failed to update automation: ${errorText(body, status)}`);
        const automation = patchedAutomation(body);
        return textResult(
          `Updated ${Object.keys(patch).join(", ")} on "${text(automation.name, parsed.id)}" [${parsed.id}].\n` +
            formatAutomationDetail(automation, false),
          { id: parsed.id, changed: Object.keys(patch) },
        );
      });
    },
  });

  pi.registerTool({
    name: "set_automation_status",
    label: "Pause or resume automation",
    description:
      "Pause or resume a scheduled automation. Pausing keeps the automation and its run history " +
      "but stops it firing — use it when the user wants a recurring job to stop for now, instead " +
      "of delete_automation. Resuming schedules the next run from now; runs missed while paused " +
      "are not backfilled.",
    parameters: Type.Object({
      id: Type.String({ description: "The automation id from list_automations." }),
      status: Type.Union([Type.Literal("active"), Type.Literal("paused")], {
        description: "'paused' stops it firing; 'active' resumes it.",
      }),
    }),
    async execute(_id, params, signal) {
      const parsed = requireId(params, "set_automation_status");
      if (!parsed.ok) return failure(parsed.error);
      const status = (params as { status?: unknown })?.status;
      if (status !== "active" && status !== "paused") {
        return failure("set_automation_status needs status 'active' or 'paused'.");
      }
      return guarded("change automation status", async () => {
        const reply = await httpJson(
          automationPath(parsed.id),
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status }),
          },
          signal,
        );
        if (!reply.ok) {
          return failure(
            `Failed to change automation status: ${errorText(reply.body, reply.status)}`,
          );
        }
        const automation = patchedAutomation(reply.body);
        const name = text(automation.name, parsed.id);
        return textResult(
          status === "paused"
            ? `Paused "${name}" [${parsed.id}]. It keeps its history and will not run until resumed.`
            : `Resumed "${name}" [${parsed.id}] — ${describeScheduleLoose(automation.schedule)}, next run ${text(automation.nextRunAt, "pending")}.`,
          { id: parsed.id, status },
        );
      });
    },
  });

  pi.registerTool({
    name: "run_automation_now",
    label: "Run automation now",
    description:
      "Run an automation immediately instead of waiting for its schedule, and report how it " +
      "went. The run happens wherever the automation is configured to run — a fresh session, or " +
      "the session it is attached to — and this tool waits for it to finish, so it can take " +
      "minutes. The schedule is kept, but the next scheduled run is re-timed from now. Use it to " +
      "prove an automation you just created or edited actually works.",
    parameters: Type.Object({
      id: Type.String({ description: "The automation id from list_automations." }),
    }),
    async execute(_id, params, signal) {
      const parsed = requireId(params, "run_automation_now");
      if (!parsed.ok) return failure(parsed.error);
      return guarded("run automation", async () => {
        const { ok, status, body } = await httpJson(
          automationPath(parsed.id, "/run"),
          { method: "POST" },
          signal,
          RUN_TIMEOUT_MS,
        );
        if (!ok) return failure(`Failed to run automation: ${errorText(body, status)}`);
        const started = (body as { started?: unknown })?.started === true;
        if (!started) {
          return textResult(
            `Automation ${parsed.id} is already running; this call did not start a second run. ` +
              `Check read_automation for the result once it finishes.`,
            { id: parsed.id, started: false },
          );
        }
        const automation = patchedAutomation(body);
        const lastRun = asRun(automation.lastRun);
        const outcome = lastRun?.outcome === "error" ? "error" : "ok";
        return textResult(
          `Ran "${text(automation.name, parsed.id)}" [${parsed.id}] — ${outcome}.\n` +
            `${formatLastRunBlock(lastRun).join("\n")}\n` +
            `next scheduled run: ${text(automation.nextRunAt, "pending")}`,
          { id: parsed.id, started: true, outcome },
        );
      });
    },
  });

  pi.registerTool({
    name: "delete_automation",
    label: "Delete automation",
    description:
      "Delete a scheduled automation permanently, together with its run history. This cannot be " +
      "undone. If the user only wants it to stop firing, use set_automation_status with " +
      "'paused' instead.",
    parameters: Type.Object({
      id: Type.String({
        description: "The automation id from list_automations, e.g. 'auto-1a2b3c4d'.",
      }),
    }),
    async execute(_id, params, signal) {
      const parsed = requireId(params, "delete_automation");
      if (!parsed.ok) return failure(parsed.error);
      return guarded("delete automation", async () => {
        const { ok, status, body } = await httpJson(
          automationPath(parsed.id),
          { method: "DELETE" },
          signal,
        );
        if (!ok) return failure(`Failed to delete automation: ${errorText(body, status)}`);
        return textResult(`Deleted automation ${parsed.id}.`, { id: parsed.id });
      });
    },
  });
}

export default function automationsExtension(pi: ExtensionAPI): void {
  registerReadTools(pi);
  registerWriteTools(pi);
}
