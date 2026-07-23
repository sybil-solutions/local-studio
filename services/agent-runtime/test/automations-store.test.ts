import { describe, expect, test } from "bun:test";
import {
  automationRunHistoryLimit,
  nextRunAt,
  prependAutomationRun,
} from "../src/automations-store";
import type { AutomationRun } from "../../../shared/agent/automation";

describe("automation scheduling", () => {
  test("advances interval schedules from the current time", () => {
    const from = new Date("2026-07-23T12:00:00.000Z");
    expect(nextRunAt({ kind: "interval", minutes: 30 }, from).toISOString()).toBe(
      "2026-07-23T12:30:00.000Z",
    );
  });

  test("skips weekends for weekday schedules", () => {
    const fridayAfterRun = new Date(2026, 6, 24, 9, 0, 0);
    const next = nextRunAt(
      { kind: "daily", time: "08:00", weekdaysOnly: true },
      fridayAfterRun,
    );
    expect(next.getDay()).toBe(1);
    expect(next.getHours()).toBe(8);
  });

  test("moves a weekly schedule to the next requested weekday", () => {
    const mondayAfterRun = new Date(2026, 6, 20, 9, 0, 0);
    const next = nextRunAt({ kind: "weekly", day: 1, time: "08:00" }, mondayAfterRun);
    expect(next.getDay()).toBe(1);
    expect(next.getDate()).toBe(27);
    expect(next.getHours()).toBe(8);
  });

  test("prepends new results and keeps a bounded automation run history", () => {
    const run = (index: number): AutomationRun => ({
      at: `2026-07-23T12:${String(index).padStart(2, "0")}:00.000Z`,
      piSessionId: `session-${index}`,
      cwd: "/workspace",
      projectId: "project-1",
      outcome: "ok",
      summary: `result-${index}`,
    });
    const existing = Array.from({ length: automationRunHistoryLimit }, (_, index) => run(index));
    const next = prependAutomationRun(existing, run(21));
    expect(next).toHaveLength(automationRunHistoryLimit);
    expect(next[0]?.summary).toBe("result-21");
    expect(next.at(-1)?.summary).toBe("result-18");
  });
});
