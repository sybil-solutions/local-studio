// Automations (Scheduled) tools for Local Studio.
//
// Lets the agent create, list and delete scheduled automations — a saved
// prompt the runtime re-runs on a cron-like schedule in its own fresh session.
// Calls proxy through the frontend like the subagents/connectors bridges, so
// this file stays a plain pi extension with no runtime imports.
//
// The record shape mirrors services/agent-runtime automations-store.ts
// (Automation): name, prompt, modelId, cwd, schedule{interval|daily|weekly}.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const FRONTEND_BASE = process.env.LOCAL_STUDIO_FRONTEND_BASE ?? "http://127.0.0.1:3000";
const CALL_TIMEOUT_MS = 30_000;

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
};

const textResult = (text: string, details: Record<string, unknown>): ToolResult => ({
  content: [{ type: "text", text }],
  details,
});

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

function isValidTime(value: unknown): value is string {
  return typeof value === "string" && /^([01]?\d|2[0-3]):[0-5]\d$/.test(value.trim());
}

/** Validate the agent-supplied schedule into the store's shape, or explain what
 *  is wrong. Kept pure so the normalization is unit-tested without HTTP. */
export function normalizeScheduleArg(
  input: ScheduleArg | undefined,
): { ok: true; schedule: NormalizedSchedule } | { ok: false; error: string } {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "schedule is required (an object with a 'kind')." };
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
  return { ok: false, error: "schedule.kind must be 'interval', 'daily' or 'weekly'." };
}

/** One-line human description of a schedule, for list output. */
export function describeSchedule(schedule: NormalizedSchedule): string {
  if (schedule.kind === "interval") return `every ${schedule.minutes} min`;
  if (schedule.kind === "daily") {
    return `daily at ${schedule.time}${schedule.weekdaysOnly ? " (weekdays)" : ""}`;
  }
  return `weekly on ${WEEKDAY_NAMES[schedule.day] ?? `day ${schedule.day}`} at ${schedule.time}`;
}

// ─── HTTP helpers ───────────────────────────────────────────────────────────

async function httpJson(
  path: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  try {
    const response = await fetch(`${FRONTEND_BASE}${path}`, {
      ...init,
      signal: controller.signal,
    });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { ok: response.ok, status: response.status, body };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

function errorText(body: unknown, status: number): string {
  if (body && typeof body === "object" && "error" in body) {
    const message = (body as { error?: unknown }).error;
    if (typeof message === "string") return message;
  }
  return `HTTP ${status}`;
}

/** Resolve the model an automation should run under: explicit arg, else the
 *  current session's model (injected by pi-runtime), else the first available. */
async function resolveModelId(
  explicit: string | undefined,
  sessionModelId: string | null,
  signal: AbortSignal | undefined,
): Promise<string | null> {
  const trimmed = explicit?.trim();
  if (trimmed) return trimmed;
  if (sessionModelId) return sessionModelId;
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

type AutomationRecord = {
  id?: unknown;
  name?: unknown;
  status?: unknown;
  nextRunAt?: unknown;
  schedule?: unknown;
};

function formatAutomationLine(record: AutomationRecord): string {
  const id = typeof record.id === "string" ? record.id : "(no id)";
  const name = typeof record.name === "string" && record.name ? record.name : "Untitled";
  const status = record.status === "paused" ? "paused" : "active";
  const scheduleText =
    record.schedule && typeof record.schedule === "object"
      ? describeScheduleLoose(record.schedule as ScheduleArg)
      : "unknown schedule";
  const next = typeof record.nextRunAt === "string" ? `, next ${record.nextRunAt}` : "";
  return `- ${name} [${id}] — ${scheduleText}, ${status}${next}`;
}

/** describeSchedule for an already-stored (normalized) schedule object. */
function describeScheduleLoose(schedule: ScheduleArg): string {
  const parsed = normalizeScheduleArg(schedule);
  return parsed.ok ? describeSchedule(parsed.schedule) : "unknown schedule";
}

export default function automationsExtension(pi: ExtensionAPI): void {
  const sessionModelId = process.env.LOCAL_STUDIO_MODEL_ID?.trim() || null;
  pi.registerTool({
    name: "schedule_automation",
    label: "Schedule automation",
    description:
      "Create a scheduled automation: a saved prompt the app re-runs on a schedule in its own " +
      "fresh session. Use for recurring work (a daily digest, an hourly check). Provide the " +
      "prompt to run and a schedule (interval minutes, or a daily/weekly time in 24h HH:MM). " +
      "The run uses the current model unless you pass one. Returns the created automation.",
    parameters: Type.Object({
      prompt: Type.String({ description: "The instruction the automation runs each time." }),
      schedule: Type.Object(
        {
          kind: Type.Union(
            [Type.Literal("interval"), Type.Literal("daily"), Type.Literal("weekly")],
            { description: "interval = every N minutes; daily/weekly = at a clock time" },
          ),
          minutes: Type.Optional(Type.Number({ description: "interval only: minutes, >= 1" })),
          time: Type.Optional(Type.String({ description: "daily/weekly only: 'HH:MM' 24h" })),
          day: Type.Optional(Type.Number({ description: "weekly only: 0-6, 0 = Sunday" })),
          weekdaysOnly: Type.Optional(
            Type.Boolean({ description: "daily only: skip Saturday/Sunday" }),
          ),
        },
        { description: "When to run." },
      ),
      name: Type.Optional(Type.String({ description: "Short display name." })),
      model: Type.Optional(
        Type.String({ description: "Model id; defaults to the current session's model." }),
      ),
      cwd: Type.Optional(
        Type.String({ description: "Working directory; defaults to the current project." }),
      ),
    }),
    async execute(_id, params, signal) {
      const args = (params ?? {}) as {
        prompt?: string;
        schedule?: ScheduleArg;
        name?: string;
        model?: string;
        cwd?: string;
      };
      const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
      if (!prompt)
        return textResult("schedule_automation needs a non-empty prompt.", { failed: true });
      const scheduleResult = normalizeScheduleArg(args.schedule);
      if (!scheduleResult.ok) return textResult(scheduleResult.error, { failed: true });
      try {
        const modelId = await resolveModelId(args.model, sessionModelId, signal);
        if (!modelId) {
          return textResult("No model available to run the automation. Pass a 'model' id.", {
            failed: true,
          });
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
              cwd: typeof args.cwd === "string" ? args.cwd : "",
              schedule: scheduleResult.schedule,
            }),
          },
          signal,
        );
        if (!ok)
          return textResult(`Failed to create automation: ${errorText(body, status)}`, {
            failed: true,
          });
        const automation = (body as { automation?: AutomationRecord }).automation ?? {};
        const id = typeof automation.id === "string" ? automation.id : "(unknown)";
        return textResult(
          `Created automation "${typeof automation.name === "string" ? automation.name : (args.name ?? "Untitled")}" [${id}] — ` +
            `${describeSchedule(scheduleResult.schedule)}. Next run ${typeof automation.nextRunAt === "string" ? automation.nextRunAt : "pending"}.`,
          { id, schedule: scheduleResult.schedule, modelId },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return textResult(`Failed to create automation: ${message}`, { failed: true });
      }
    },
  });

  pi.registerTool({
    name: "list_automations",
    label: "List automations",
    description: "List the scheduled automations: name, id, schedule, status and next run time.",
    parameters: Type.Object({}),
    async execute(_id, _params, signal) {
      try {
        const { ok, status, body } = await httpJson(
          "/api/agent/automations",
          { method: "GET" },
          signal,
        );
        if (!ok)
          return textResult(`Failed to list automations: ${errorText(body, status)}`, {
            failed: true,
          });
        const automations = Array.isArray((body as { automations?: unknown }).automations)
          ? (body as { automations: AutomationRecord[] }).automations
          : [];
        if (automations.length === 0)
          return textResult("No automations are scheduled.", { count: 0 });
        const lines = automations.map(formatAutomationLine);
        return textResult(`${automations.length} automation(s):\n${lines.join("\n")}`, {
          count: automations.length,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return textResult(`Failed to list automations: ${message}`, { failed: true });
      }
    },
  });

  pi.registerTool({
    name: "delete_automation",
    label: "Delete automation",
    description: "Delete a scheduled automation by its id (get ids from list_automations).",
    parameters: Type.Object({
      id: Type.String({ description: "The automation id, e.g. 'auto-1a2b3c4d'." }),
    }),
    async execute(_id, params, signal) {
      const id =
        typeof (params as { id?: unknown })?.id === "string"
          ? (params as { id: string }).id.trim()
          : "";
      if (!id) return textResult("delete_automation needs an automation id.", { failed: true });
      try {
        const { ok, status, body } = await httpJson(
          `/api/agent/automations/${encodeURIComponent(id)}`,
          { method: "DELETE" },
          signal,
        );
        if (!ok)
          return textResult(`Failed to delete automation: ${errorText(body, status)}`, {
            failed: true,
          });
        return textResult(`Deleted automation ${id}.`, { id });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return textResult(`Failed to delete automation: ${message}`, { failed: true });
      }
    },
  });
}
