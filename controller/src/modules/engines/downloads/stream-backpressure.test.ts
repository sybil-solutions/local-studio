import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { trackWriterFailure, waitForWriterDrain } from "./stream-backpressure";

describe("download stream backpressure", () => {
  test("cleans up temporary listeners after repeated drain cycles", async () => {
    const writer = new PassThrough();
    const failure = trackWriterFailure(writer);

    for (let cycle = 0; cycle < 12; cycle += 1) {
      const drained = waitForWriterDrain(writer);
      expect(writer.listenerCount("drain")).toBe(1);
      expect(writer.listenerCount("error")).toBe(2);

      writer.emit("drain");
      await drained;

      expect(writer.listenerCount("drain")).toBe(0);
      expect(writer.listenerCount("error")).toBe(1);
    }

    failure.dispose();
    expect(writer.listenerCount("error")).toBe(0);
  });

  test("cleans up a failed wait and preserves the writer failure", async () => {
    const writer = new PassThrough();
    const failure = trackWriterFailure(writer);
    const drained = waitForWriterDrain(writer);
    const error = new Error("disk write failed");

    writer.emit("error", error);

    await expect(drained).rejects.toThrow("disk write failed");
    expect(writer.listenerCount("drain")).toBe(0);
    expect(writer.listenerCount("error")).toBe(1);
    expect(() => failure.throwIfFailed()).toThrow("disk write failed");

    failure.dispose();
    expect(writer.listenerCount("error")).toBe(0);
  });

  test("preserves a writer failure between drain cycles", () => {
    const writer = new PassThrough();
    const failure = trackWriterFailure(writer);

    writer.emit("error", new Error("disk disconnected"));

    expect(() => failure.throwIfFailed()).toThrow("disk disconnected");
    failure.dispose();
    expect(writer.listenerCount("error")).toBe(0);
  });
});
