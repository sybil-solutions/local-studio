import { describe, expect, test } from "bun:test";
import {
  goalContinuationPrompt,
  goalOutcomeFromText,
  isGoalContinuationPrompt,
  stripGoalSentinels,
} from "../../../shared/agent/goal-protocol";
import { goalSystemPromptSection } from "../src/goal-prompt";

describe("continuation prompts are recognisable on both sides", () => {
  test("the driver's own re-prompt is tagged so the transcript can drop it", () => {
    const prompt = goalContinuationPrompt("ship the release");
    expect(isGoalContinuationPrompt(prompt)).toBe(true);
    expect(prompt).toContain("ship the release");
  });

  test("anything the user actually typed is not", () => {
    expect(isGoalContinuationPrompt("Continue working toward the goal: ship it")).toBe(false);
    expect(isGoalContinuationPrompt("")).toBe(false);
  });
});

describe("outcome sentinels", () => {
  test("a completion is read from the sentinel, not from the prose around it", () => {
    expect(goalOutcomeFromText("Everything builds.\n\nGOAL_COMPLETE")).toEqual({
      kind: "complete",
    });
  });

  test("a block carries its reason", () => {
    expect(goalOutcomeFromText("GOAL_BLOCKED: no network access")).toEqual({
      kind: "blocked",
      reason: "no network access",
    });
  });

  test("an ordinary turn declares nothing", () => {
    expect(goalOutcomeFromText("I rebuilt the bundle and it passes.")).toBeNull();
  });
});

describe("sentinels never reach the rendered bubble", () => {
  test("the sentinel and its line are removed", () => {
    expect(stripGoalSentinels("Done.\nGOAL_COMPLETE")).toBe("Done.");
    expect(stripGoalSentinels("Stuck.\nGOAL_BLOCKED — no network")).toBe("Stuck.");
  });

  test("a half-streamed sentinel is hidden instead of flickering through", () => {
    expect(stripGoalSentinels("Done.\nGOAL_COMP")).toBe("Done.");
    expect(stripGoalSentinels("Done.\nGOAL_BLO")).toBe("Done.");
  });

  test("ordinary prose about a goal survives, identity included", () => {
    const text = "The goal here is GOAL clarity";
    expect(stripGoalSentinels(text)).toBe(text);
    expect(stripGoalSentinels("no sentinels\n")).toBe("no sentinels\n");
  });
});

describe("the goal steers only while it is being pursued", () => {
  test("an active goal is injected", () => {
    const section = goalSystemPromptSection({ objective: "ship it", status: "active" });
    expect(section).toContain("<objective>ship it</objective>");
  });

  test("a spent budget stops steering instead of nagging every later user turn", () => {
    expect(
      goalSystemPromptSection({ objective: "ship it", status: "budget_limited", turnBudget: 3 }),
    ).toBeNull();
  });

  test("paused, complete and blocked goals stay in the store but stop pushing", () => {
    for (const status of ["paused", "complete", "blocked"]) {
      expect(goalSystemPromptSection({ objective: "ship it", status })).toBeNull();
    }
  });
});
