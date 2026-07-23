import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Automation } from "@shared/agent/automation";
import {
  draftIsValid,
  filterAutomations,
  scheduleLabel,
  type AutomationDraft,
} from "./automation-model";

const automation = (patch: Partial<Automation> = {}): Automation => ({
  version: 1,
  id: "auto-1",
  name: "Daily brief",
  prompt: "Review my work",
  modelId: "local/model",
  cwd: "/workspace",
  schedule: { kind: "daily", time: "08:00", weekdaysOnly: true },
  status: "active",
  nextRunAt: "2026-07-24T12:00:00.000Z",
  lastRun: null,
  unread: false,
  createdAt: "2026-07-23T12:00:00.000Z",
  updatedAt: "2026-07-23T12:00:00.000Z",
  ...patch,
});

describe("automation model", () => {
  test("formats each supported schedule", () => {
    assert.equal(scheduleLabel({ kind: "interval", minutes: 30 }), "Every 30 minutes");
    assert.equal(scheduleLabel({ kind: "interval", minutes: 60 }), "Every hour");
    assert.equal(
      scheduleLabel({ kind: "daily", time: "08:00", weekdaysOnly: true }),
      "Weekdays at 08:00",
    );
    assert.equal(scheduleLabel({ kind: "weekly", day: 5, time: "16:00" }), "Friday at 16:00");
  });

  test("filters by status and searchable automation fields", () => {
    const paused = automation({
      id: "auto-2",
      name: "Weekly review",
      prompt: "Write a status update",
      status: "paused",
    });
    assert.deepEqual(filterAutomations([automation(), paused], "", "active"), [automation()]);
    assert.deepEqual(filterAutomations([automation(), paused], "status update", "all"), [paused]);
    assert.equal(filterAutomations([automation(), paused], "LOCAL/MODEL", "all").length, 2);
  });

  test("requires a name, prompt, and model before saving", () => {
    const valid: AutomationDraft = {
      name: "Daily brief",
      prompt: "Review my work",
      modelId: "local/model",
      cwd: "",
      schedule: { kind: "daily", time: "08:00" },
    };
    assert.equal(draftIsValid(valid), true);
    assert.equal(draftIsValid({ ...valid, prompt: " " }), false);
    assert.equal(draftIsValid({ ...valid, name: "" }), false);
    assert.equal(draftIsValid({ ...valid, modelId: "" }), false);
  });
});
