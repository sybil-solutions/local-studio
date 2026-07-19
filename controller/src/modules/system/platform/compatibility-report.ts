import type {
  CompatibilityCheck,
  CompatibilityReport,
  CompatibilitySeverity,
  RuntimeGpuMonitoringTool,
  RuntimeRocmSmiTool,
  SystemRuntimeInfo,
} from "../../models/types";
import { Effect } from "effect";
import { runCommandAsyncEffect } from "../../../core/command";
import { resolveAmdSmiBinary, resolveNvidiaSmiBinary, resolveRocmSmiBinary } from "./smi-tools";

const toEvidence = (lines: Array<string | null | undefined>): string | null => {
  const filtered = lines.filter((line): line is string => Boolean(line && line.trim()));
  return filtered.length ? filtered.join("\n") : null;
};

const addCheck = (
  checks: CompatibilityCheck[],
  check: Omit<CompatibilityCheck, "severity"> & { severity: CompatibilitySeverity },
): void => {
  checks.push({
    id: check.id,
    severity: check.severity,
    message: check.message,
    evidence: check.evidence ?? null,
    suggested_fix: check.suggested_fix ?? null,
  });
};

export const probeGpuMonitoring = (
  kind: SystemRuntimeInfo["platform"]["kind"],
  rocmTool: RuntimeRocmSmiTool | null,
): Effect.Effect<{ available: boolean; tool: RuntimeGpuMonitoringTool | null }> => {
  const probe = (binary: string, args: string[]): Effect.Effect<boolean> =>
    runCommandAsyncEffect(binary, args, { timeoutMs: 2_000 }).pipe(
      Effect.map((result) => result.status === 0),
    );

  if (kind === "cuda") {
    const binary = resolveNvidiaSmiBinary();
    if (!binary) return Effect.succeed({ available: false, tool: "nvidia-smi" });
    return probe(binary, ["--query-gpu=name", "--format=csv,noheader,nounits"]).pipe(
      Effect.map((available) => ({ available, tool: "nvidia-smi" as const })),
    );
  }

  if (kind === "rocm") {
    const preferred = rocmTool ?? (resolveAmdSmiBinary() ? "amd-smi" : null);

    if (preferred === "amd-smi") {
      const binary = resolveAmdSmiBinary();
      if (!binary) return Effect.succeed({ available: false, tool: "amd-smi" });
      return probe(binary, ["version"]).pipe(
        Effect.map((available) => ({ available, tool: "amd-smi" as const })),
      );
    }

    if (preferred === "rocm-smi") {
      const binary = resolveRocmSmiBinary();
      if (!binary) return Effect.succeed({ available: false, tool: "rocm-smi" });
      return probe(binary, ["--showproductname"]).pipe(
        Effect.map((available) => ({ available, tool: "rocm-smi" as const })),
      );
    }

    const amd = resolveAmdSmiBinary();
    const rocm = resolveRocmSmiBinary();
    return Effect.gen(function* () {
      if (amd && (yield* probe(amd, ["version"]))) {
        return { available: true, tool: "amd-smi" as const };
      }
      if (rocm && (yield* probe(rocm, ["--showproductname"]))) {
        return { available: true, tool: "rocm-smi" as const };
      }
      return { available: false, tool: null };
    });
  }

  return Effect.succeed({ available: false, tool: null });
};

export const buildCompatibilityReport = (args: {
  runtime: SystemRuntimeInfo;
  inference_port: number;
  inference_port_open: boolean;
  inference_process_known: boolean;
  gpu_monitoring: { available: boolean; tool: RuntimeGpuMonitoringTool | null };
}): CompatibilityReport => {
  const { runtime } = args;
  const checks: CompatibilityCheck[] = [];
  const gpuMonitoring = args.gpu_monitoring;

  if (runtime.gpus.count === 0) {
    addCheck(checks, {
      id: "gpu.none-detected",
      severity: "warn",
      message: "No GPUs detected by the controller.",
      evidence: toEvidence([
        `platform.kind=${runtime.platform.kind}`,
        `gpus.count=${runtime.gpus.count}`,
      ]),
      suggested_fix:
        runtime.platform.kind === "rocm"
          ? "Verify ROCm is installed and GPU tools are available (amd-smi/rocm-smi)."
          : runtime.platform.kind === "cuda"
            ? "Verify NVIDIA drivers are installed and nvidia-smi is accessible."
            : "Verify GPU drivers are installed and set LOCAL_STUDIO_GPU_SMI_TOOL if needed.",
    });
  }

  if (runtime.platform.kind === "rocm" && !runtime.platform.torch.torch_hip) {
    addCheck(checks, {
      id: "torch.rocm-missing-hip",
      severity: "error",
      message:
        "ROCm platform detected, but PyTorch does not report HIP support (torch.version.hip is null).",
      evidence: toEvidence([
        `torch_version=${runtime.platform.torch.torch_version ?? "null"}`,
        `torch_hip=${runtime.platform.torch.torch_hip ?? "null"}`,
      ]),
      suggested_fix:
        "Install a ROCm-enabled PyTorch build that matches your ROCm version, and ensure the controller is using that Python environment.",
    });
  }

  if (runtime.platform.kind === "rocm" && !gpuMonitoring.available) {
    addCheck(checks, {
      id: "gpu-monitoring.rocm-unavailable",
      severity: "warn",
      message: "ROCm platform detected, but GPU monitoring tooling is not accessible.",
      evidence: toEvidence([`tool=${gpuMonitoring.tool ?? "null"}`]),
      suggested_fix:
        "Ensure `amd-smi` or `rocm-smi` is installed and on PATH, or set AMD_SMI_PATH/ROCM_SMI_PATH.",
    });
  }

  if (runtime.platform.kind === "cuda" && !gpuMonitoring.available) {
    addCheck(checks, {
      id: "gpu-monitoring.cuda-unavailable",
      severity: "warn",
      message:
        "CUDA platform detected, but nvidia-smi is not accessible (GPU telemetry may be unavailable).",
      evidence: toEvidence([`tool=${gpuMonitoring.tool ?? "nvidia-smi"}`]),
      suggested_fix:
        "Ensure NVIDIA drivers are installed and nvidia-smi is on PATH (snap-installed bun can block access).",
    });
  }

  if (args.inference_port_open && !args.inference_process_known) {
    addCheck(checks, {
      id: "inference.port-in-use",
      severity: "error",
      message: "Inference port is in use by an unknown process.",
      evidence: toEvidence([`inference_port=${args.inference_port}`]),
      suggested_fix:
        "Stop the process using the inference port, or change LOCAL_STUDIO_INFERENCE_PORT to a free port.",
    });
  }

  const mlxInstalled = runtime.backends.mlx?.installed ?? false;
  if (
    !runtime.backends.vllm.installed &&
    !runtime.backends.sglang.installed &&
    !runtime.backends.llamacpp.installed &&
    !mlxInstalled
  ) {
    addCheck(checks, {
      id: "backends.none-installed",
      severity: "info",
      message: "No inference runtime backends appear to be installed.",
      evidence: null,
      suggested_fix:
        "Install at least one backend runtime (vLLM, SGLang, llama.cpp, or MLX), then restart the controller.",
    });
  }

  return {
    platform: { kind: runtime.platform.kind },
    gpu_monitoring: gpuMonitoring,
    torch: runtime.platform.torch,
    backends: runtime.backends,
    checks,
  };
};
