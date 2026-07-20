import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { Effect, Fiber } from "effect";
import {
  trackWriterFailure,
  waitForWriterDrain,
} from "../../src/modules/engines/downloads/stream-backpressure";

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect);

describe("download stream backpressure", () => {
  test("cleans up temporary listeners after repeated drain cycles", async () => {
    const writer = new PassThrough();
    const failure = trackWriterFailure(writer);

    for (let cycle = 0; cycle < 12; cycle += 1) {
      const drained = run(waitForWriterDrain(writer));
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

  test("cleans up failed and interrupted waits", async () => {
    const writer = new PassThrough();
    const failure = trackWriterFailure(writer);
    const drained = run(waitForWriterDrain(writer));
    writer.emit("error", "disk write failed");

    await expect(drained).rejects.toThrow("disk write failed");
    await expect(run(failure.failed)).rejects.toThrow("disk write failed");
    expect(writer.listenerCount("drain")).toBe(0);
    expect(writer.listenerCount("error")).toBe(1);
    expect(() => failure.throwIfFailed()).toThrow("disk write failed");

    failure.dispose();
    const interrupted = new PassThrough();
    const fiber = Effect.runFork(waitForWriterDrain(interrupted));
    expect(interrupted.listenerCount("drain")).toBe(1);
    await run(Fiber.interrupt(fiber));
    expect(interrupted.listenerCount("drain")).toBe(0);
    expect(interrupted.listenerCount("error")).toBe(0);
  });

  test("preserves the first writer failure", () => {
    const writer = new PassThrough();
    const failure = trackWriterFailure(writer);
    writer.emit("error", new Error("disk disconnected"));
    writer.emit("error", new Error("later failure"));
    expect(() => failure.throwIfFailed()).toThrow("disk disconnected");
    failure.dispose();
    expect(writer.listenerCount("error")).toBe(0);
  });
});
