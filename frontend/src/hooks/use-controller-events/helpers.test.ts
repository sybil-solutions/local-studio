import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchCustomEvent } from "./helpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("controller event helpers", () => {
  it("dispatches custom events in browser runtimes", () => {
    const listener = vi.fn();
    window.addEventListener("vllm:test", listener);

    dispatchCustomEvent("vllm:test", { ok: true });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0]?.[0]).toMatchObject({ detail: { ok: true } });
    window.removeEventListener("vllm:test", listener);
  });

  it("is a no-op without window", () => {
    vi.stubGlobal("window", undefined);

    expect(() => dispatchCustomEvent("vllm:test", {})).not.toThrow();
  });
});
