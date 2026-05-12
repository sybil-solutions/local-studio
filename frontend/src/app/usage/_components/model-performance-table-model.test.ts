import { describe, expect, it } from "vitest";
import type { PeakMetrics } from "@/lib/types";
import {
  modelDisplayName,
  resolveSpeedDisplay,
  type ModelData,
} from "./model-performance-table-model";

const peak = (overrides: Partial<PeakMetrics> = {}): PeakMetrics => ({
  model_id: "provider/model-name",
  prefill_tps: null,
  generation_tps: null,
  ttft_ms: null,
  total_tokens: 10,
  total_requests: 1,
  ...overrides,
});

const model = (overrides: Partial<ModelData> = {}): ModelData => ({
  model: "provider/model-name",
  requests: 1,
  total_tokens: 10,
  success_rate: 100,
  avg_latency_ms: null,
  avg_ttft_ms: null,
  tokens_per_sec: null,
  prefill_tps: null,
  generation_tps: null,
  prompt_tokens: 4,
  completion_tokens: 6,
  avg_tokens: 10,
  p50_latency_ms: null,
  ...overrides,
});

describe("model performance table model", () => {
  it("uses the last model path segment as the display name", () => {
    expect(modelDisplayName("openai/gpt-5.5")).toBe("gpt-5.5");
    expect(modelDisplayName("local-model")).toBe("local-model");
  });

  it("prefers split current speed metrics over aggregate and peak metrics", () => {
    expect(
      resolveSpeedDisplay(
        model({ prefill_tps: 123.4, generation_tps: 56.7, tokens_per_sec: 10 }),
        peak({ prefill_tps: 1000, generation_tps: 200, ttft_ms: 50 }),
      ),
    ).toEqual({ kind: "rows", muted: false, rows: ["123 prefill", "57 gen"] });
  });

  it("falls back from aggregate current speed to peak metrics to empty state", () => {
    expect(resolveSpeedDisplay(model({ tokens_per_sec: 19.8 }), undefined)).toEqual({
      kind: "single",
      text: "20 tok/s",
    });
    expect(resolveSpeedDisplay(model(), peak({ prefill_tps: 1000 }))).toEqual({
      kind: "rows",
      muted: true,
      rows: ["peak 1000 prefill"],
    });
    expect(resolveSpeedDisplay(model(), undefined)).toEqual({ kind: "empty" });
  });
});
