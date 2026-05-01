// CRITICAL
import { describe, expect, it } from "bun:test";
import { ensureStreamingUsageIncluded } from "./openai-routes";

describe("openai route request normalization", () => {
  it("injects stream_options.include_usage for streaming requests", () => {
    const payload: Record<string, unknown> = {
      model: "deepseek-v4-flash",
      stream: true,
      stream_options: { other: "preserved" },
    };

    expect(ensureStreamingUsageIncluded(payload)).toBe(true);
    expect(payload["stream_options"]).toEqual({ other: "preserved", include_usage: true });
  });

  it("leaves non-streaming requests unchanged", () => {
    const payload: Record<string, unknown> = { model: "deepseek-v4-flash", stream: false };

    expect(ensureStreamingUsageIncluded(payload)).toBe(false);
    expect(payload["stream_options"]).toBeUndefined();
  });

  it("does not rewrite streaming requests that already include usage", () => {
    const streamOptions = { include_usage: true, other: "preserved" };
    const payload: Record<string, unknown> = {
      model: "deepseek-v4-flash",
      stream: true,
      stream_options: streamOptions,
    };

    expect(ensureStreamingUsageIncluded(payload)).toBe(false);
    expect(payload["stream_options"]).toBe(streamOptions);
  });

  it("preserves existing stream_options when injecting include_usage", () => {
    const payload: Record<string, unknown> = {
      stream: true,
      stream_options: { extra: "data" },
    };
    expect(ensureStreamingUsageIncluded(payload)).toBe(true);
    expect(payload["stream_options"]).toEqual({ extra: "data", include_usage: true });
  });

  it("handles missing stream key as non-streaming", () => {
    const payload: Record<string, unknown> = { model: "test" };
    expect(ensureStreamingUsageIncluded(payload)).toBe(false);
  });

  it("handles stream_options as non-object by replacing", () => {
    const payload: Record<string, unknown> = {
      stream: true,
      stream_options: "invalid",
    };
    expect(ensureStreamingUsageIncluded(payload)).toBe(true);
    expect(payload["stream_options"]).toEqual({ include_usage: true });
  });

  it("handles stream_options as array by replacing", () => {
    const payload: Record<string, unknown> = {
      stream: true,
      stream_options: [{ include_usage: true }],
    };
    expect(ensureStreamingUsageIncluded(payload)).toBe(true);
    expect(payload["stream_options"]).toEqual({ include_usage: true });
  });

  it("handles null stream_options", () => {
    const payload: Record<string, unknown> = {
      stream: true,
      stream_options: null,
    };
    expect(ensureStreamingUsageIncluded(payload)).toBe(true);
    expect(payload["stream_options"]).toEqual({ include_usage: true });
  });

  it("handles falsy stream values", () => {
    expect(ensureStreamingUsageIncluded({ stream: 0 } as unknown as Record<string, unknown>)).toBe(false);
    expect(ensureStreamingUsageIncluded({ stream: "" } as unknown as Record<string, unknown>)).toBe(false);
    expect(ensureStreamingUsageIncluded({ stream: null } as unknown as Record<string, unknown>)).toBe(false);
  });

  it("handles truthy stream values", () => {
    expect(ensureStreamingUsageIncluded({ stream: 1 } as unknown as Record<string, unknown>)).toBe(true);
    expect(ensureStreamingUsageIncluded({ stream: "true" } as unknown as Record<string, unknown>)).toBe(true);
  });
});
