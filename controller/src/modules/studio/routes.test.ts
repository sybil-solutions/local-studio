import { describe, expect, it } from "bun:test";
import type { GpuInfo } from "../lifecycle/types";
import { deriveRecommendationVramGb } from "./routes";

const gpu = (overrides: Partial<GpuInfo>): GpuInfo => ({
  index: 0,
  name: "GPU",
  memory_total: 0,
  memory_total_mb: 0,
  memory_used: 0,
  memory_used_mb: 0,
  memory_free: 0,
  memory_free_mb: 0,
  utilization: 0,
  utilization_pct: 0,
  temperature: 0,
  temp_c: 0,
  power_draw: 0,
  power_limit: 0,
  ...overrides,
});

describe("deriveRecommendationVramGb", () => {
  it("uses per-GPU capacity instead of summing across devices", () => {
    const value = deriveRecommendationVramGb([
      gpu({ index: 0, memory_total_mb: 8192 }),
      gpu({ index: 1, memory_total_mb: 8192 }),
    ]);
    expect(value).toBe(8);
  });

  it("falls back to byte-based memory_total when memory_total_mb is unavailable", () => {
    const value = deriveRecommendationVramGb([
      gpu({ memory_total_mb: 0, memory_total: 24 * 1024 ** 3 }),
    ]);
    expect(value).toBe(24);
  });

  it("returns 0 when no GPUs are present", () => {
    expect(deriveRecommendationVramGb([])).toBe(0);
  });
});
