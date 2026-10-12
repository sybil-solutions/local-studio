import { describe, expect, test } from "bun:test";
import { inferReasoningSupport, normalizeOpenAIModel } from "../../../shared/agent/models";
import { controllerModelThinkingLevels, modelsToPiModels } from "../src/pi-runtime-models";

describe("Inkling thinking levels", () => {
  test("detects Inkling as a reasoning model", () => {
    expect(inferReasoningSupport("inkling-small")).toBe(true);
    expect(normalizeOpenAIModel({ id: "inkling-small" }).reasoning).toBe(true);
  });

  test("exposes only effort names accepted by the checkpoint template", () => {
    expect(controllerModelThinkingLevels(true, "inkling-small")).toEqual([
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "max",
    ]);
  });

  test("exposes every supported controller effort", () => {
    expect(controllerModelThinkingLevels(true, "deepseek-v4")).toEqual([
      "auto",
      "low",
      "medium",
      "high",
      "max",
      "off",
    ]);
  });

  test("maps Local Studio levels to Inkling reasoning_effort values", () => {
    const [model] = modelsToPiModels([
      {
        id: "inkling-small",
        name: "Inkling Small",
        provider: "local-studio",
        contextWindow: 262_144,
        maxTokens: 65_536,
        reasoning: true,
        vision: true,
        active: true,
      },
    ]);

    expect(model?.thinkingLevelMap).toEqual({
      off: "none",
      minimal: "minimal",
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: null,
      max: "max",
    });
    expect(model?.compat.supportsReasoningEffort).toBe(true);
  });
});
