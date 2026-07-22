import { describe, expect, test } from "bun:test";
import { shouldBufferImplicitReasoning } from "../src/modules/proxy/chat-completions-stream";
import type { Recipe } from "../src/modules/models/types";
import { doneFrame, runStream, sseFrame } from "./stream-test-helpers";

const recipe = (overrides: Partial<Recipe>): Recipe =>
  ({
    id: "recipe",
    served_model_name: "model",
    model_path: "model",
    reasoning_parser: null,
    backend: "vllm",
    ...overrides,
  }) as unknown as Recipe;

describe("shouldBufferImplicitReasoning", () => {
  test("engine-parsed reasoning model does not buffer implicit content", () => {
    expect(
      shouldBufferImplicitReasoning({
        matchedRecipe: recipe({
          backend: "vllm",
          reasoning_parser: "deepseek_r1",
          served_model_name: "deepseek-r1",
        }),
        recordedModel: "deepseek-r1",
      }),
    ).toBe(false);
  });

  test("provider-routed reasoning model with no matched recipe buffers implicit content", () => {
    expect(
      shouldBufferImplicitReasoning({
        matchedRecipe: null,
        recordedModel: "openrouter/deepseek-r1",
      }),
    ).toBe(true);
  });

  test("non-reasoning model never buffers", () => {
    expect(
      shouldBufferImplicitReasoning({ matchedRecipe: null, recordedModel: "gpt-4o-mini" }),
    ).toBe(false);
  });
});

describe("streaming contract", () => {
  test("engine-parsed reasoning content is streamed live, not withheld", async () => {
    const bufferImplicit = shouldBufferImplicitReasoning({
      matchedRecipe: recipe({
        backend: "vllm",
        reasoning_parser: "deepseek_r1",
        served_model_name: "deepseek-r1",
      }),
      recordedModel: "deepseek-r1",
    });
    const deltas = await runStream(
      [sseFrame({ content: "Hello " }), sseFrame({ content: "world" }), doneFrame()],
      bufferImplicit,
    );
    const contentDeltas = deltas.filter((delta) => delta.content);
    expect(contentDeltas.length).toBe(2);
    expect(contentDeltas.every((delta) => delta.beforeDone)).toBe(true);
    expect(contentDeltas.map((delta) => delta.content).join("")).toBe("Hello world");
  });

  test("implicit chain-of-thought is not leaked as visible content when no upstream parser", async () => {
    const bufferImplicit = shouldBufferImplicitReasoning({
      matchedRecipe: null,
      recordedModel: "openrouter/deepseek-r1",
    });
    const deltas = await runStream(
      [
        sseFrame({ content: "secret reasoning " }),
        sseFrame({ content: "</think>" }),
        sseFrame({ content: "The answer" }),
        doneFrame(),
      ],
      bufferImplicit,
    );
    const contentText = deltas.map((delta) => delta.content ?? "").join("");
    const reasoningText = deltas.map((delta) => delta.reasoning_content ?? "").join("");
    expect(contentText).toBe("The answer");
    expect(contentText).not.toContain("secret reasoning");
    expect(reasoningText).toBe("secret reasoning ");
  });
});
