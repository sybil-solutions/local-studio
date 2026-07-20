import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { decodeSetupProgress } from "./setup-progress";

describe("setup progress", () => {
  test("restores valid progress and clamps the step", () => {
    const progress = decodeSetupProgress({
      step: 99,
      hardwareConfirmed: true,
      selectedModel: "org/model",
      manualModelId: "org/manual",
      selectedPreset: null,
      createdRecipeId: "recipe-1",
    });
    assert.equal(progress.step, 5);
    assert.equal(progress.hardwareConfirmed, true);
    assert.equal(progress.selectedModel, "org/model");
  });

  test("falls back safely for malformed persisted data", () => {
    assert.deepEqual(decodeSetupProgress({ step: "three" }), {
      step: 0,
      hardwareConfirmed: false,
      selectedModel: "",
      manualModelId: "",
      selectedPreset: null,
      createdRecipeId: null,
    });
  });
});
