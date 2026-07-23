import { describe, expect, test } from "bun:test";
import { nextRunAt } from "../src/automations-store";

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
});
