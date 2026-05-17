import { describe, expect, it } from "vitest";
import type { StudioDiagnostics, VllmUpgradeResult } from "@/lib/types";
import { buildHardwareSummary, buildUpgradeMessage } from "./step-hardware-model";

function diagnostics(overrides: Partial<StudioDiagnostics> = {}): StudioDiagnostics {
  return {
    app_version: "0.2.1",
    timestamp: "2026-05-12T00:00:00.000Z",
    platform: "linux",
    arch: "x64",
    release: "6.8",
    cpu_model: "AMD EPYC",
    cpu_cores: 64,
    memory_total: 128 * 1024 ** 3,
    memory_free: 64 * 1024 ** 3,
    gpus: [
      {
        index: 0,
        name: "RTX 3090",
        memory_total: 24 * 1024 ** 3,
        memory_total_mb: 24 * 1024,
        memory_used: 0,
        memory_used_mb: 0,
        memory_free: 24 * 1024 ** 3,
        memory_free_mb: 24 * 1024,
        utilization: 0,
        utilization_pct: 0,
        temperature: 0,
        temp_c: 0,
        power_draw: 0,
        power_limit: 0,
      },
    ],
    runtime: {
      vllm_installed: true,
      vllm_version: "0.20.0",
      python_path: "/venv/bin/python",
      vllm_bin: "/venv/bin/vllm",
    },
    disks: [],
    config: {
      host: "0.0.0.0",
      port: 8080,
      inference_port: 8000,
      api_key_configured: false,
      models_dir: "/models",
      data_dir: "/data",
      db_path: "/data/controller.db",
      sglang_python: null,
      tabby_api_dir: null,
      llama_bin: null,
      ds4_bin: null,
    },
    ...overrides,
  };
}

describe("step hardware model", () => {
  it("builds loaded hardware copy from diagnostics", () => {
    expect(buildHardwareSummary(diagnostics())).toMatchObject({
      cpu: "AMD EPYC · 64 cores",
      gpu: "RTX 3090",
      runtime: "vLLM 0.20.0 detected.",
      vram: "24 GB",
    });
  });

  it("uses fallback copy before diagnostics and for CPU-only devices", () => {
    expect(buildHardwareSummary(null)).toMatchObject({
      cpu: "Unknown · 0 cores",
      gpu: "No CUDA GPU detected",
      runtime: "vLLM runtime not detected. Install to continue.",
      vram: "CPU only",
    });
    expect(buildHardwareSummary(diagnostics({ gpus: [] })).vram).toBe("CPU only");
  });

  it("formats runtime upgrade result copy and tone", () => {
    const success: VllmUpgradeResult = {
      success: true,
      version: "0.20.0",
      output: "done",
      error: null,
      used_command: "uv pip install",
      used_wheel: null,
    };
    expect(buildUpgradeMessage(success)).toEqual({
      text: "Updated to vLLM 0.20.0",
      toneClassName: "text-(--hl2)",
    });
    expect(buildUpgradeMessage({ ...success, success: false, error: "failed" })).toEqual({
      text: "failed",
      toneClassName: "text-(--err)",
    });
  });
});
