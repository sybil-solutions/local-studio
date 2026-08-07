import assert from "node:assert/strict";
import { describe, expect, test } from "bun:test";
import automationsExtension, { describeSchedule, normalizeScheduleArg } from "./automations";

type ScheduleTool = {
  execute: (
    id: string,
    params: {
      prompt: string;
      schedule: { kind: "interval"; minutes: number };
    },
    signal?: AbortSignal,
  ) => Promise<{ details: Record<string, unknown> }>;
  name: string;
};

describe("normalizeScheduleArg", () => {
  test("accepts an interval schedule and rounds minutes", () => {
    const result = normalizeScheduleArg({ kind: "interval", minutes: 30.4 });
    expect(result).toEqual({ ok: true, schedule: { kind: "interval", minutes: 30 } });
  });

  test("rejects an interval below one minute", () => {
    const result = normalizeScheduleArg({ kind: "interval", minutes: 0 });
    expect(result.ok).toBe(false);
  });

  test("accepts a daily schedule and carries weekdaysOnly only when true", () => {
    expect(normalizeScheduleArg({ kind: "daily", time: "08:30" })).toEqual({
      ok: true,
      schedule: { kind: "daily", time: "08:30" },
    });
    expect(normalizeScheduleArg({ kind: "daily", time: "9:05", weekdaysOnly: true })).toEqual({
      ok: true,
      schedule: { kind: "daily", time: "9:05", weekdaysOnly: true },
    });
  });

  test("rejects a malformed time", () => {
    expect(normalizeScheduleArg({ kind: "daily", time: "25:00" }).ok).toBe(false);
    expect(normalizeScheduleArg({ kind: "daily", time: "noon" }).ok).toBe(false);
    expect(normalizeScheduleArg({ kind: "daily" }).ok).toBe(false);
  });

  test("accepts a weekly schedule with a valid weekday", () => {
    expect(normalizeScheduleArg({ kind: "weekly", day: 1, time: "07:00" })).toEqual({
      ok: true,
      schedule: { kind: "weekly", day: 1, time: "07:00" },
    });
  });

  test("rejects an out-of-range weekday", () => {
    expect(normalizeScheduleArg({ kind: "weekly", day: 7, time: "07:00" }).ok).toBe(false);
  });

  test("rejects missing or unknown kinds", () => {
    expect(normalizeScheduleArg(undefined).ok).toBe(false);
    expect(normalizeScheduleArg({ kind: "hourly" }).ok).toBe(false);
  });
});

describe("describeSchedule", () => {
  test("renders each schedule kind for list output", () => {
    expect(describeSchedule({ kind: "interval", minutes: 15 })).toBe("every 15 min");
    expect(describeSchedule({ kind: "daily", time: "08:00" })).toBe("daily at 08:00");
    expect(describeSchedule({ kind: "daily", time: "08:00", weekdaysOnly: true })).toBe(
      "daily at 08:00 (weekdays)",
    );
    expect(describeSchedule({ kind: "weekly", day: 1, time: "07:00" })).toBe(
      "weekly on Monday at 07:00",
    );
  });
});

test("schedule tool retains the session model after environment restoration", async () => {
  let scheduleTool: ScheduleTool | null = null;
  const previousModel = process.env.LOCAL_STUDIO_MODEL_ID;
  try {
    process.env.LOCAL_STUDIO_MODEL_ID = "session-model";
    automationsExtension({
      registerTool(tool: unknown) {
        const registered = tool as ScheduleTool;
        if (registered.name === "schedule_automation") scheduleTool = registered;
      },
    } as unknown as Parameters<typeof automationsExtension>[0]);
  } finally {
    if (previousModel === undefined) delete process.env.LOCAL_STUDIO_MODEL_ID;
    else process.env.LOCAL_STUDIO_MODEL_ID = previousModel;
  }

  const requests: Request[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    requests.push(new Request(input, init));
    return Promise.resolve(Response.json({ automation: { id: "automation-1", name: "Audit" } }));
  };
  try {
    if (!scheduleTool) throw new Error("schedule_automation was not registered");
    const result = await scheduleTool.execute("call-1", {
      prompt: "Run an audit",
      schedule: { kind: "interval", minutes: 30 },
    });
    assert.equal(result.details.modelId, "session-model");
    assert.equal(requests.length, 1);
    assert.equal((await requests[0]?.json()).modelId, "session-model");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
