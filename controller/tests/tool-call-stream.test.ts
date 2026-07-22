import { describe, expect, test } from "bun:test";
import { doneFrame, runStream, sseFrame } from "./stream-test-helpers";

describe("implicit reasoning buffering", () => {
  test("upstream reasoning field resolves buffering so content streams live", async () => {
    const deltas = await runStream([
      sseFrame({ reasoning_content: "thinking... " }),
      sseFrame({ content: "Hello " }),
      sseFrame({ content: "world" }),
      doneFrame(),
    ], true);
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
    ], true);
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
    ], true);
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
    ], true);
    expect(deltas.map((delta) => delta.content ?? "").join("")).toBe("plain answer");
  });
});
