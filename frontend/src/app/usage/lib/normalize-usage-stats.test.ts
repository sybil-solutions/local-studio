import { describe, expect, it } from "vitest";
import { formatDuration, formatNumber } from "@/lib/formatters";
import { normalizeUsageStats } from "./normalize-usage-stats";
import type { UsageStats } from "@/lib/types";

describe("usage normalization", () => {
  it("coerces null and partial usage payloads into render-safe numbers", () => {
    const stats = normalizeUsageStats({
      totals: {
        total_tokens: null,
        prompt_tokens: "1200",
        success_rate: null,
      },
      by_model: [
        {
          model: null,
          requests: null,
          total_tokens: "2500",
          success_rate: null,
          prefill_tps: "18393.5",
          generation_tps: null,
        },
      ],
      daily: [{ date: "2026-04-26", total_tokens: null, requests: "2" }],
      hourly_pattern: [{ hour: "13", requests: null }],
    } as unknown as UsageStats);

    expect(stats.totals.total_tokens).toBe(0);
    expect(stats.totals.prompt_tokens).toBe(1200);
    expect(stats.totals.success_rate).toBe(0);
    expect(stats.by_model[0]).toMatchObject({
      model: "unknown-1",
      requests: 0,
      total_tokens: 2500,
      success_rate: 0,
      prefill_tps: 18393.5,
      generation_tps: null,
    });
    expect(stats.daily[0]).toMatchObject({ total_tokens: 0, requests: 2 });
    expect(stats.hourly_pattern[0]).toMatchObject({ hour: 13, requests: 0 });
  });

  it("formatters do not throw on null backend values", () => {
    expect(formatNumber(null)).toBe("0");
    expect(formatNumber(undefined)).toBe("0");
    expect(formatDuration(null)).toBe("0ms");
  });
});
