import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentModel } from "@/features/agent/workspace/types";
import { splitVisibleAgentModels } from "./model-visibility";

function model(id: string, controllerUrl?: string): AgentModel {
  return {
    id,
    name: id,
    provider: "local-studio",
    ...(controllerUrl ? { controllerUrl } : {}),
    contextWindow: 128_000,
    maxTokens: 32_000,
    reasoning: false,
    vision: false,
    active: true,
  };
}

test("model visibility defaults to controller models", () => {
  const controller = model("controller", "http://127.0.0.1:8000");
  const other = model("provider/model");
  const result = splitVisibleAgentModels([controller, other], false);

  assert.deepEqual(result.controllerModels, [controller]);
  assert.deepEqual(result.otherModels, [other]);
  assert.deepEqual(result.visibleModels, [controller]);
});

test("model visibility includes Pi and provider models after opt in", () => {
  const controller = model("controller", "http://127.0.0.1:8000");
  const other = model("provider/model");
  const result = splitVisibleAgentModels([controller, other], true);

  assert.deepEqual(result.visibleModels, [controller, other]);
});
