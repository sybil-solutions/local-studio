import { arch, platform as operatingSystem } from "node:os";
import { Effect } from "effect";
import type {
  RuntimeCudaInfo,
  RuntimePlatformInfo,
  RuntimePlatformKind,
  SystemRuntimeInfo,
} from "../../models/types";
import { runCommandAsyncEffect } from "../../../core/command";
import { queryNvidiaSmiSnapshot } from "../../system/platform/gpu";
import { extractCudaVersion } from "./cuda-version";
import { probeGpuMonitoring } from "../../system/platform/compatibility-report";
import { getRocmInfo, resolveRocmSmiTool } from "../../system/platform/rocm-info";
import { resolveNvidiaSmiBinary } from "../../system/platform/smi-tools";
import type { HostProfile } from "../../compute/contracts";
import { getRuntimeTargets, runtimeTargetToBackendInfo } from "./runtime-targets";

/**
 * Host runtime facts for /status and /compat: platform kind, GPU monitoring,
 * CUDA driver, and the per-engine docker-image state. Docker-only means there
 * are no python environments to probe — torch build info is gone with them.
 */

const SYSTEM_RUNTIME_CACHE_TTL_MS = 30_000;
let systemRuntimeCache: { expiresAt: number; value: SystemRuntimeInfo } | null = null;

export const detectPlatformKind = (args: {
  forcedSmiTool: string | undefined;
  hasNvidiaSmi: boolean;
  hasRocmSmi: boolean;
  isAppleSilicon?: boolean;
}): RuntimePlatformKind => {
  const forced = args.forcedSmiTool?.trim();
  if (forced === "nvidia-smi") return "cuda";
  if (forced === "amd-smi" || forced === "rocm-smi") return "rocm";
  if (args.hasNvidiaSmi) return "cuda";
  if (args.hasRocmSmi) return "rocm";
  if (args.isAppleSilicon) return "metal";
  return "unknown";
};

const extractNvccVersion = (output: string): string | null => {
  const match = output.match(/release\s+([0-9.]+)/i);
  if (match) return match[1] ?? null;
  return null;
};

export const getCudaInfo = (
  knownDriverVersion: string | null = null,
): Effect.Effect<RuntimeCudaInfo> =>
  Effect.gen(function* () {
    const nvidiaSmi = process.env["NVIDIA_SMI_PATH"] || "nvidia-smi";
    let driverVersion = knownDriverVersion;
    let cudaVersion: string | null = null;
    if (!driverVersion) {
      const driverResult = yield* runCommandAsyncEffect(
        nvidiaSmi,
        ["--query-gpu=driver_version", "--format=csv,noheader,nounits"],
        { timeoutMs: 5_000 },
      );
      if (driverResult.status === 0 && driverResult.stdout) {
        driverVersion = driverResult.stdout.split("\n")[0]?.trim() || null;
      }
    }
    const smiResult = yield* runCommandAsyncEffect(nvidiaSmi, [], { timeoutMs: 5_000 });
    if (smiResult.status === 0) {
      cudaVersion = extractCudaVersion(smiResult.stdout) ?? extractCudaVersion(smiResult.stderr);
    }
    if (!cudaVersion) {
      const nvccResult = yield* runCommandAsyncEffect("nvcc", ["--version"], { timeoutMs: 5_000 });
      if (nvccResult.status === 0) {
        cudaVersion =
          extractNvccVersion(nvccResult.stdout) ?? extractNvccVersion(nvccResult.stderr);
      }
    }
    return {
      driver_version: driverVersion,
      cuda_version: cudaVersion,
      upgrade_command_available: false,
    };
  });

export const getSystemRuntimeInfo = (host: HostProfile): Effect.Effect<SystemRuntimeInfo> =>
  Effect.gen(function* () {
    const now = Date.now();
    if (systemRuntimeCache && systemRuntimeCache.expiresAt > now) {
      return systemRuntimeCache.value;
    }
    const forcedSmiTool = process.env["LOCAL_STUDIO_GPU_SMI_TOOL"];
    const hasNvidiaSmi = Boolean(resolveNvidiaSmiBinary());
    const rocmSmiTool = resolveRocmSmiTool();
    const nvidiaAllowed = !forcedSmiTool?.trim() || forcedSmiTool.trim() === "nvidia-smi";

    const [nvidiaSnapshot, targets] = yield* Effect.all(
      [
        nvidiaAllowed && hasNvidiaSmi ? queryNvidiaSmiSnapshot() : Effect.succeed(null),
        getRuntimeTargets(host),
      ] as const,
      { concurrency: "unbounded" },
    );
    const kind = detectPlatformKind({
      forcedSmiTool,
      hasNvidiaSmi,
      hasRocmSmi: Boolean(rocmSmiTool),
      isAppleSilicon: operatingSystem() === "darwin" && arch() === "arm64",
    });
    const rocm = kind === "rocm" ? yield* getRocmInfo(rocmSmiTool) : null;
    const platform: RuntimePlatformInfo = {
      kind,
      vendor:
        kind === "cuda" ? "nvidia" : kind === "rocm" ? "amd" : kind === "metal" ? "apple" : null,
      rocm,
      torch: { torch_version: null, torch_cuda: null, torch_hip: null },
    };
    const [gpuMonitoring, cuda] = yield* Effect.all(
      [
        kind === "metal"
          ? Effect.succeed({ available: false, tool: "apple-metal" as const })
          : kind === "cuda" && nvidiaSnapshot
            ? Effect.succeed({ available: nvidiaSnapshot.available, tool: "nvidia-smi" as const })
            : probeGpuMonitoring(kind, rocmSmiTool),
        kind === "cuda"
          ? getCudaInfo(nvidiaSnapshot?.driverVersion ?? null)
          : Effect.succeed({
              driver_version: null,
              cuda_version: null,
              upgrade_command_available: false,
            }),
      ] as const,
      { concurrency: "unbounded" },
    );
    const infoFor = (backend: "vllm" | "sglang" | "exllamav3"): SystemRuntimeInfo["backends"]["vllm"] =>
      runtimeTargetToBackendInfo(targets.find((target) => target.backend === backend) ?? null);
    const value: SystemRuntimeInfo = {
      platform,
      gpu_monitoring: gpuMonitoring,
      cuda,
      gpus: {
        count: host.deviceCount,
        types: nvidiaSnapshot?.gpus
          ? [...new Set(nvidiaSnapshot.gpus.map((gpu) => gpu.name).filter((name) => name && name !== "Unknown"))]
          : [],
      },
      backends: {
        vllm: infoFor("vllm"),
        sglang: infoFor("sglang"),
        exllamav3: infoFor("exllamav3"),
      },
    };
    systemRuntimeCache = { expiresAt: Date.now() + SYSTEM_RUNTIME_CACHE_TTL_MS, value };
    return value;
  });

export const shutdownRuntimeInfo = (): Effect.Effect<void> =>
  Effect.sync(() => {
    systemRuntimeCache = null;
  });
