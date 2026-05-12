import { describe, expect, it } from "vitest";
import type { GPU, LaunchProgressData, Metrics, ProcessInfo } from "@/lib/types";
import type { LeaseInfo, RuntimeSummaryData, ServiceEntry, StatusData } from "./types";
import {
  areGpusEqual,
  areLaunchProgressEqual,
  areLeasesEqual,
  areMetricsEqual,
  arePlatformKindsEqual,
  areRuntimeSummariesEqual,
  areServicesEqual,
  areStatusEqual,
} from "./equality";

const processInfo: ProcessInfo = {
  pid: 1,
  backend: "vllm",
  model_path: "/models/a",
  port: 8000,
  served_model_name: "a",
};

const status: StatusData = {
  running: true,
  process: processInfo,
  inference_port: 8000,
  launching: null,
};

const gpu: GPU = {
  index: 0,
  name: "RTX 3090",
  memory_total: 24,
  memory_used: 4,
  memory_free: 20,
  utilization: 50,
  temperature: 60,
  power_draw: 250,
  power_limit: 350,
};

const backend = { installed: true, version: "1.0" };
const runtimeSummary: RuntimeSummaryData = {
  platform: { kind: "cuda", vendor: "nvidia" },
  gpu_monitoring: { available: true, tool: "nvidia-smi" },
  backends: { vllm: backend, mlx: backend, sglang: backend, llamacpp: backend },
};

describe("realtime status equality", () => {
  it("compares status and nested process identity", () => {
    expect(areStatusEqual(status, status)).toBe(true);
    expect(areStatusEqual(status, null)).toBe(false);
    expect(areStatusEqual(status, { ...status, process: { ...processInfo, pid: 2 } })).toBe(false);
    expect(areStatusEqual(status, { ...status, inference_port: 8001 })).toBe(false);
  });

  it("compares GPU arrays using stable runtime fields", () => {
    expect(areGpusEqual([gpu], [gpu])).toBe(true);
    expect(areGpusEqual([gpu], [])).toBe(false);
    expect(areGpusEqual([gpu], [{ ...gpu, memory_used: 5 }])).toBe(false);
    expect(
      areGpusEqual(
        [{ ...gpu, temperature: undefined }],
        [{ ...gpu, temperature: null } as unknown as GPU],
      ),
    ).toBe(true);
  });

  it("compares metrics by exact key/value shape", () => {
    const metrics: Metrics = { requests_total: 1, tokens_total: 2 };
    expect(areMetricsEqual(metrics, { ...metrics })).toBe(true);
    expect(areMetricsEqual(metrics, { ...metrics, latency_avg: 10 })).toBe(false);
    expect(areMetricsEqual(metrics, { requests_total: 2, tokens_total: 2 })).toBe(false);
    expect(areMetricsEqual(metrics, null)).toBe(false);
  });

  it("compares launch, platform, service, lease, and runtime-summary snapshots", () => {
    const launch: LaunchProgressData = { recipe_id: "r1", stage: "launching", message: "Booting" };
    const service: ServiceEntry = { id: "controller", kind: "api", status: "running" };
    const lease: LeaseInfo = { holder: "session-1", since: "now" };

    expect(areLaunchProgressEqual(launch, { ...launch })).toBe(true);
    expect(areLaunchProgressEqual(launch, { ...launch, progress: 50 })).toBe(false);
    expect(arePlatformKindsEqual("cuda", "cuda")).toBe(true);
    expect(arePlatformKindsEqual("cuda", "rocm")).toBe(false);
    expect(areServicesEqual([service], [{ ...service }])).toBe(true);
    expect(areServicesEqual([service], [{ ...service, status: "stopped" }])).toBe(false);
    expect(areLeasesEqual(lease, { holder: "session-1", since: "later" })).toBe(true);
    expect(areLeasesEqual(lease, { ...lease, holder: "session-2" })).toBe(false);
    expect(areRuntimeSummariesEqual(runtimeSummary, { ...runtimeSummary })).toBe(true);
    expect(
      areRuntimeSummariesEqual(runtimeSummary, {
        ...runtimeSummary,
        gpu_monitoring: { ...runtimeSummary.gpu_monitoring, tool: null },
      }),
    ).toBe(false);
  });
});
