import { describe, expect, test } from "bun:test";
import { createLaunchState } from "./launch-state";

describe("launch state", () => {
  test("admits one synchronous attempt and returns the active conflict", () => {
    const state = createLaunchState();
    const first = state.tryAcquire("recipe-a");
    if (!first.acquired) throw new Error("Expected the first launch to acquire");

    const conflict = state.tryAcquire("recipe-b");
    expect(conflict).toEqual({ acquired: false, activeAttempt: first.attempt });
    expect(state.getState()).toEqual({ phase: "launching", recipeId: "recipe-a" });
    expect(state.getLaunchingRecipeId()).toBe("recipe-a");
    expect(state.getActiveAttempt()).toBe(first.attempt);
    expect(Object.isFrozen(first.attempt)).toBe(true);
  });

  test("only the owning token releases and stale cleanup cannot clear a successor", () => {
    const state = createLaunchState();
    const first = state.tryAcquire("recipe-a");
    if (!first.acquired) throw new Error("Expected the first launch to acquire");

    expect(state.release("not-the-owner")).toBe(false);
    expect(state.release(first.attempt.attemptId)).toBe(true);
    expect(state.release(first.attempt.attemptId)).toBe(false);

    const second = state.tryAcquire("recipe-a");
    if (!second.acquired) throw new Error("Expected the successor launch to acquire");

    expect(second.attempt.attemptId).not.toBe(first.attempt.attemptId);
    expect(state.release(first.attempt.attemptId)).toBe(false);
    expect(state.getActiveAttempt()).toBe(second.attempt);
    expect(state.release(second.attempt.attemptId)).toBe(true);
    expect(state.getState()).toEqual({ phase: "idle", recipeId: null });
  });
});
