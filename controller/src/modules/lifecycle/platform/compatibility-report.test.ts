// CRITICAL
import { describe, expect, it } from "bun:test";
import type { SystemRuntimeInfo } from "../types";
import { buildCompatibilityReport } from "./compatibility-report";

const baseRuntime = (overrides: Partial<SystemRuntimeInfo>): SystemRuntimeInfo => ({
  platform: {
    kind: "unknown",
    vendor: null,
    rocm: null,
    torch: { torch_version: null, torch_cuda: null, torch_hip: null },
  },
  gpu_monitoring: {
    available: false,
    tool: null,
  },
  cuda: {
    driver_version: null,
    cuda_version: null,
    upgrade_command_available: false,
  },
  gpus: {
    count: 0,
    types: [],
  },
  backends: {
    vllm: { installed: false, version: null, python_path: null, binary_path: null },
    sglang: { installed: false, version: null, python_path: null, binary_path: null },
    llamacpp: { installed: false, version: null, python_path: null, binary_path: null },
  },
  ...overrides,
});

describe("compatibility report", () => {
  it("flags missing torch HIP on ROCm", () => {
    const report = buildCompatibilityReport({
      runtime: baseRuntime({
        platform: {
          kind: "rocm",
          vendor: "amd",
          rocm: {
            rocm_version: "7.1.1",
            hip_version: "7.1.1",
            smi_tool: "amd-smi",
            gpu_arch: [],
            upgrade_command_available: true,
          },
          torch: { torch_version: "2.6.0", torch_cuda: null, torch_hip: null },
        },
        gpus: { count: 1, types: ["AMD Instinct MI300X"] },
      }),
      inference_port: 8000,
      inference_port_open: false,
      inference_process_known: false,
      gpu_monitoring: { available: true, tool: "amd-smi" },
    });

    expect(report.checks.some((check) => check.id === "torch.rocm-missing-hip")).toBe(true);
  });

  it("flags unavailable ROCm monitoring", () => {
    const report = buildCompatibilityReport({
      runtime: baseRuntime({
        platform: {
          kind: "rocm",
          vendor: "amd",
          rocm: {
            rocm_version: "7.1.1",
            hip_version: "7.1.1",
            smi_tool: "amd-smi",
            gpu_arch: [],
            upgrade_command_available: true,
          },
          torch: { torch_version: "2.6.0", torch_cuda: null, torch_hip: "7.1.1" },
        },
        gpus: { count: 1, types: ["AMD Instinct MI300X"] },
      }),
      inference_port: 8000,
      inference_port_open: false,
      inference_process_known: false,
      gpu_monitoring: { available: false, tool: "amd-smi" },
    });

    expect(report.checks.some((check) => check.id === "gpu-monitoring.rocm-unavailable")).toBe(true);
  });

  it("flags inference port in use by unknown process", () => {
    const report = buildCompatibilityReport({
      runtime: baseRuntime({}),
      inference_port: 8000,
      inference_port_open: true,
      inference_process_known: false,
      gpu_monitoring: { available: false, tool: null },
    });

    expect(report.checks.some((check) => check.id === "inference.port-in-use")).toBe(true);
  });
});
