//
// Automations: scheduled prompts that run headless in the agent runtime and
// land as ordinary sessions (the Codex "Scheduled" model). One JSON file per
// automation under <dataDir>/automations/, written through the same atomic
// per-file lock the session stores use.
//

import { readdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { resolveDataDir } from "./data-dir";
import { createSessionScopedJsonStore } from "./session-json-store";
import { isRecord } from "../../../shared/agent/guards";

export type AutomationSchedule =
  | { kind: "interval"; minutes: number }
  | { kind: "daily"; time: string; weekdaysOnly?: boolean }
  | { kind: "weekly"; day: number; time: string };

export type AutomationRun = {
  at: string;
  piSessionId: string | null;
  outcome: "ok" | "error";
  summary: string;
  error?: string;
};

export type Automation = {
  version: 1;
  id: string;
  name: string;
  prompt: string;
  modelId: string;
  cwd: string;
  schedule: AutomationSchedule;
  status: "active" | "paused";
  nextRunAt: string | null;
  lastRun: AutomationRun | null;
  unread: boolean;
  createdAt: string;
  updatedAt: string;
};

const AUTOMATIONS_SUBDIR = "automations";
const MAX_SUMMARY_CHARS = 2000;

function normalizeSchedule(value: unknown): AutomationSchedule {
  if (isRecord(value)) {
    if (value.kind === "interval" && typeof value.minutes === "number" && value.minutes >= 1) {
      return { kind: "interval", minutes: Math.round(value.minutes) };
    }
    if (value.kind === "daily" && typeof value.time === "string") {
      return {
        kind: "daily",
        time: value.time,
        ...(value.weekdaysOnly === true ? { weekdaysOnly: true } : {}),
      };
    }
    if (
      value.kind === "weekly" &&
      typeof value.day === "number" &&
      typeof value.time === "string"
    ) {
      return { kind: "weekly", day: Math.min(6, Math.max(0, Math.round(value.day))), time: value.time };
    }
  }
  return { kind: "daily", time: "08:00" };
}

function normalizeRun(value: unknown): AutomationRun | null {
  if (!isRecord(value) || typeof value.at !== "string") return null;
  return {
    at: value.at,
    piSessionId: typeof value.piSessionId === "string" ? value.piSessionId : null,
    outcome: value.outcome === "error" ? "error" : "ok",
    summary: typeof value.summary === "string" ? value.summary.slice(0, MAX_SUMMARY_CHARS) : "",
    ...(typeof value.error === "string" ? { error: value.error } : {}),
  };
}

function normalizeAutomation(value: unknown): Automation {
  const record = isRecord(value) ? value : {};
  const now = new Date().toISOString();
  return {
    version: 1,
    id: typeof record.id === "string" ? record.id : "",
    name: typeof record.name === "string" ? record.name : "Untitled automation",
    prompt: typeof record.prompt === "string" ? record.prompt : "",
    modelId: typeof record.modelId === "string" ? record.modelId : "",
    cwd: typeof record.cwd === "string" ? record.cwd : "",
    schedule: normalizeSchedule(record.schedule),
    status: record.status === "paused" ? "paused" : "active",
    nextRunAt: typeof record.nextRunAt === "string" ? record.nextRunAt : null,
    lastRun: normalizeRun(record.lastRun),
    unread: record.unread === true,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : now,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : now,
  };
}

const store = createSessionScopedJsonStore<Automation>({
  subdir: AUTOMATIONS_SUBDIR,
  legacyFile: "automations-legacy.json",
  normalize: normalizeAutomation,
});

function parseTime(time: string): { hours: number; minutes: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  const hours = match ? Math.min(23, Number(match[1])) : 8;
  const minutes = match ? Math.min(59, Number(match[2])) : 0;
  return { hours, minutes };
}

/** Next occurrence strictly after `from`. Pure so the schedule math is testable. */
export function nextRunAt(schedule: AutomationSchedule, from: Date): Date {
  if (schedule.kind === "interval") {
    return new Date(from.getTime() + schedule.minutes * 60_000);
  }
  const { hours, minutes } = parseTime(schedule.time);
  const candidate = new Date(from);
  candidate.setHours(hours, minutes, 0, 0);
  const advanceDays = (date: Date, days: number) => {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  };
  if (schedule.kind === "daily") {
    let next = candidate <= from ? advanceDays(candidate, 1) : candidate;
    if (schedule.weekdaysOnly) {
      while (next.getDay() === 0 || next.getDay() === 6) next = advanceDays(next, 1);
    }
    return next;
  }
  let next = candidate;
  const targetDay = schedule.day;
  while (next.getDay() !== targetDay || next <= from) next = advanceDays(next, 1);
  return next;
}

export async function listAutomations(): Promise<Automation[]> {
  const dir = path.join(resolveDataDir(), AUTOMATIONS_SUBDIR);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const automations: Automation[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const automation = await store.read(entry.slice(0, -5));
    if (automation.id) automations.push(automation);
  }
  return automations.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getAutomation(id: string): Promise<Automation | null> {
  const automation = await store.read(id);
  return automation.id ? automation : null;
}

export async function createAutomation(input: {
  name: string;
  prompt: string;
  modelId: string;
  cwd: string;
  schedule: unknown;
}): Promise<Automation> {
  const id = `auto-${randomUUID().slice(0, 8)}`;
  const schedule = normalizeSchedule(input.schedule);
  return store.write(
    {
      version: 1,
      id,
      name: input.name.trim() || "Untitled automation",
      prompt: input.prompt,
      modelId: input.modelId,
      cwd: input.cwd,
      schedule,
      status: "active",
      nextRunAt: nextRunAt(schedule, new Date()).toISOString(),
      lastRun: null,
      unread: false,
      createdAt: new Date().toISOString(),
    },
    id,
  );
}

export async function patchAutomation(
  id: string,
  patch: Partial<Pick<Automation, "name" | "prompt" | "modelId" | "cwd" | "status" | "unread">> & {
    schedule?: unknown;
    nextRunAt?: string | null;
    lastRun?: AutomationRun | null;
  },
): Promise<Automation | null> {
  const existing = await getAutomation(id);
  if (!existing) return null;
  const { schedule: rawSchedule, ...rest } = patch;
  const schedule = rawSchedule === undefined ? undefined : normalizeSchedule(rawSchedule);
  const next = await store.write(
    {
      ...rest,
      ...(schedule ? { schedule } : {}),
      // Schedule or status changes recompute the next occurrence.
      ...(schedule || patch.status === "active"
        ? { nextRunAt: nextRunAt(schedule ?? existing.schedule, new Date()).toISOString() }
        : {}),
    },
    id,
  );
  return next;
}

export async function deleteAutomation(id: string): Promise<boolean> {
  const existing = await getAutomation(id);
  if (!existing) return false;
  await rm(path.join(resolveDataDir(), AUTOMATIONS_SUBDIR, `${id}.json`), { force: true });
  return true;
}

export const automationSummaryLimit = MAX_SUMMARY_CHARS;
