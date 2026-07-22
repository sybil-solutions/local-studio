import { describe, expect, test } from "bun:test";
import { createToolCallStream } from "../src/modules/proxy/tool-call-stream";

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

const runStream = async (frames: Uint8Array[]): Promise<ObservedDelta[]> => {
  const source = new ReadableStream<Uint8Array>({
    start(controller): void {
      for (const frame of frames) controller.enqueue(frame);
      controller.close();
    },
  });
  const reader = createToolCallStream(source, undefined, undefined, {
    bufferImplicitReasoningContent: true,
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

describe("implicit reasoning buffering", () => {
  test("upstream reasoning field resolves buffering so content streams live", async () => {
    const deltas = await runStream([
      sseFrame({ reasoning_content: "thinking... " }),
      sseFrame({ content: "Hello " }),
      sseFrame({ content: "world" }),
      doneFrame(),
    ]);
    const contentDeltas = deltas.filter((delta) => delta.content);
    expect(contentDeltas.length).toBe(2);
    expect(contentDeltas.every((delta) => delta.beforeDone)).toBe(true);
    expect(contentDeltas.map((delta) => delta.content).join("")).toBe("Hello world");
  });

  test("content pending before the first reasoning field is released as content", async () => {
    const deltas = await runStream([
      sseFrame({ content: "prefix " }),
      sseFrame({ reasoning_content: "thinking... " }),
      sseFrame({ content: "answer" }),
      doneFrame(),
    ]);
    const contentDeltas = deltas.filter((delta) => delta.content);
    expect(contentDeltas.map((delta) => delta.content).join("")).toBe("prefix answer");
    expect(contentDeltas.every((delta) => delta.beforeDone)).toBe(true);
  });

  test("implicit think prefix is reclassified as reasoning at close tag", async () => {
    const deltas = await runStream([
      sseFrame({ content: "let me think " }),
      sseFrame({ content: "</think>" }),
      sseFrame({ content: "The answer" }),
      doneFrame(),
    ]);
    const reasoningText = deltas.map((delta) => delta.reasoning_content ?? "").join("");
    const contentText = deltas.map((delta) => delta.content ?? "").join("");
    expect(reasoningText).toBe("let me think ");
    expect(contentText).toBe("The answer");
    expect(deltas.filter((delta) => delta.content).every((delta) => delta.beforeDone)).toBe(true);
  });

  test("unresolved implicit prefix is flushed as content at stream end", async () => {
    const deltas = await runStream([
      sseFrame({ content: "plain answer" }),
      doneFrame(),
    ]);
    expect(deltas.map((delta) => delta.content ?? "").join("")).toBe("plain answer");
  });
});
