import { describe, expect, test } from "bun:test";
import { shouldBufferImplicitReasoning } from "../src/modules/proxy/chat-completions-stream";
import { createToolCallStream } from "../src/modules/proxy/tool-call-stream";
import type { Recipe } from "../src/modules/models/types";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const sseFrame = (delta: Record<string, unknown>): Uint8Array =>
  encoder.encode(`data: ${JSON.stringify({ id: "c", choices: [{ index: 0, delta }] })}\n\n`);

const doneFrame = (): Uint8Array => encoder.encode("data: [DONE]\n\n");

interface ObservedDelta {
  content?: string;
  reasoning_content?: string;
  beforeDone: boolean;
}

const runStream = async (
  frames: Uint8Array[],
  bufferImplicitReasoningContent: boolean,
): Promise<ObservedDelta[]> => {
  const source = new ReadableStream<Uint8Array>({
    start(controller): void {
      for (const frame of frames) controller.enqueue(frame);
      controller.close();
    },
  });
  const reader = createToolCallStream(source, undefined, undefined, {
    bufferImplicitReasoningContent,
  }).getReader();
  const deltas: ObservedDelta[] = [];
  let doneSeen = false;
  let accumulator = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    accumulator += decoder.decode(value, { stream: true });
    let separatorIndex: number;
    while ((separatorIndex = accumulator.indexOf("\n\n")) >= 0) {
      const frame = accumulator.slice(0, separatorIndex);
      accumulator = accumulator.slice(separatorIndex + 2);
      const line = frame.split("\n").find((entry) => entry.startsWith("data: "));
      if (!line) continue;
      if (line === "data: [DONE]") {
        doneSeen = true;
        continue;
      }
      const parsed = JSON.parse(line.slice(6)) as {
        choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }>;
      };
      const delta = parsed.choices?.[0]?.delta;
      if (delta && (delta.content || delta.reasoning_content)) {
        deltas.push({ ...delta, beforeDone: !doneSeen });
      }
    }
  }
  return deltas;
};

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
