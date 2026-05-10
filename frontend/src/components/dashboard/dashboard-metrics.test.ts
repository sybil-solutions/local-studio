import { describe, expect, it } from "vitest";
import type { Metrics, ProcessInfo } from "@/lib/types";
import {
  metricsBelongToProcess,
  metricsWithProcessIdentity,
  scopedMetrics,
} from "./dashboard-metrics";

const activeProcess = (overrides: Partial<ProcessInfo> = {}): ProcessInfo => ({
  pid: 123,
  backend: "sglang",
  model_path: "/models/Step-3.5-Flash",
  port: 8000,
  served_model_name: "Step-3.5-Flash",
  ...overrides,
});

describe("dashboard metric scoping", () => {
  it("rejects metrics from the previously running model", () => {
    const metrics: Metrics = {
      model_id: "deepseek-v4-flash",
      generation_throughput: 184.6,
      avg_ttft_ms: 412,
    };

    expect(metricsBelongToProcess(metrics, activeProcess())).toBe(false);
    expect(scopedMetrics(metrics, activeProcess())).toBeNull();
  });

  it("accepts identity-less live counters while a model is active", () => {
    const metrics: Metrics = {
      generation_throughput: 184.6,
      avg_ttft_ms: 412,
    };

    expect(scopedMetrics(metrics, activeProcess())).toBe(metrics);
  });

  it("hydrates identity-less controller metrics from the active process before scoping", () => {
    const metrics: Metrics = {
      generation_throughput: 0,
      prompt_tokens_total: 835_425,
      generation_tokens_total: 41_543,
    };
    const hydrated = metricsWithProcessIdentity(metrics, activeProcess());

    expect(hydrated).toMatchObject({
      model_id: "Step-3.5-Flash",
      model_path: "/models/Step-3.5-Flash",
      served_model_name: "Step-3.5-Flash",
    });
    expect(scopedMetrics(hydrated, activeProcess())).toBe(hydrated);
  });

  it("accepts metrics with a matching served model name", () => {
    const metrics: Metrics = {
      served_model_name: "step-3.5-flash",
      generation_throughput: 12,
    };

    expect(scopedMetrics(metrics, activeProcess())).toBe(metrics);
  });

  it("accepts metrics whose path basename matches the active process", () => {
    const metrics: Metrics = {
      model_path: "/mnt/models/step-3.5-flash/",
      prompt_throughput: 55,
    };

    expect(scopedMetrics(metrics, activeProcess())).toBe(metrics);
  });

  it("accepts metrics with a compatible model id variant", () => {
    const metrics: Metrics = {
      model_id: "step-3.5-flash-fp8",
      prompt_throughput: 55,
    };

    expect(scopedMetrics(metrics, activeProcess())).toBe(metrics);
  });

  it("rejects metrics when there is no active process", () => {
    expect(scopedMetrics({ model_id: "Step-3.5-Flash" }, null)).toBeNull();
  });
});
