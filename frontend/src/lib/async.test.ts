import { describe, expect, it, vi } from "vitest";
import { delay } from "./async";

describe("delay", () => {
  it("resolves after the requested timeout", async () => {
    vi.useFakeTimers();
    const pending = vi.fn();
    const promise = delay(25).then(pending);

    await vi.advanceTimersByTimeAsync(24);
    expect(pending).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await promise;
    expect(pending).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
