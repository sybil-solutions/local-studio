// CRITICAL
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type {
  RuntimeBackendInfo,
  RuntimeCudaInfo,
  RuntimePlatformInfo,
  RuntimePlatformKind,
  RuntimeTorchBuildInfo,
  SystemRuntimeInfo,
} from "./types";
import type { Config } from "../../config/env";
import { resolveBinary, runCommand } from "../../core/command";
import { getGpuInfo } from "./gpu";
import { getVllmRuntimeInfo } from "./vllm-runtime";
import { probeGpuMonitoring } from "./platform/compatibility-report";
import { getRocmInfo, resolveRocmSmiTool } from "./platform/rocm-info";
import { resolveNvidiaSmiBinary } from "./platform/smi-tools";
import { getTorchBuildInfo } from "./platform/torch-info";

const extractCudaVersion = (output: string): string | null => {
  const match = output.match(/CUDA Version\s*:\s*([0-9.]+)/i);
  if (match) {
    return match[1] ?? null;
  }
  return null;
};

const extractNvccVersion = (output: string): string | null => {
  const match = output.match(/release\s+([0-9.]+)/i);
  if (match) {
    return match[1] ?? null;
  }
  return null;
};

export const getCudaInfo = (): RuntimeCudaInfo => {
  const nvidiaSmi = process.env["NVIDIA_SMI_PATH"] || "nvidia-smi";
  let driverVersion: string | null = null;
  let cudaVersion: string | null = null;

  const driverResult = runCommand(nvidiaSmi, [
    "--query-gpu=driver_version",
    "--format=csv,noheader,nounits",
  ]);
  if (driverResult.status === 0 && driverResult.stdout) {
    driverVersion = driverResult.stdout.split("\n")[0]?.trim() || null;
  }

  const smiResult = runCommand(nvidiaSmi, []);
  if (smiResult.status === 0) {
    cudaVersion = extractCudaVersion(smiResult.stdout) ?? extractCudaVersion(smiResult.stderr);
  }

  if (!cudaVersion) {
    const nvccResult = runCommand("nvcc", ["--version"]);
    if (nvccResult.status === 0) {
      cudaVersion = extractNvccVersion(nvccResult.stdout) ?? extractNvccVersion(nvccResult.stderr);
    }
  }

  return {
    driver_version: driverVersion,
    cuda_version: cudaVersion,
  };
};

export const detectPlatformKind = (args: {
  forcedSmiTool: string | undefined;
  torch: RuntimeTorchBuildInfo;
  hasNvidiaSmi: boolean;
  hasRocmSmi: boolean;
}): RuntimePlatformKind => {
  const forced = args.forcedSmiTool?.trim();
  if (forced === "nvidia-smi") return "cuda";
  if (forced === "amd-smi" || forced === "rocm-smi") return "rocm";

  if (args.torch.torch_hip) return "rocm";
  if (args.torch.torch_cuda) return "cuda";

  if (args.hasNvidiaSmi) return "cuda";
  if (args.hasRocmSmi) return "rocm";
  return "unknown";
};

const getSglangRuntimeInfo = (config: Config): RuntimeBackendInfo => {
  const python = config.sglang_python || "python3";
  const result = runCommand(python, [
    "-c",
    "import json, sys\ntry:\n import sglang\n print(json.dumps({'version': getattr(sglang, '__version__', None), 'python': sys.executable}))\nexcept Exception:\n print(json.dumps({'version': None, 'python': sys.executable}))",
  ]);

  if (result.status !== 0) {
    return {
      installed: false,
      version: null,
      python_path: config.sglang_python ?? null,
    };
  }

  let parsed: { version?: string | null; python?: string | null } | null = null;
  try {
    parsed = JSON.parse(result.stdout) as { version?: string | null; python?: string | null };
  } catch {
    parsed = null;
  }

  return {
    installed: Boolean(parsed?.version),
    version: parsed?.version ?? null,
    python_path: parsed?.python ?? config.sglang_python ?? null,
  };
};

const parseLlamaVersion = (output: string): string | null => {
  if (!output) return null;
  const match = output.match(/version\s*[:=]\s*([^\s]+)/i);
  if (match) {
    return match[1] ?? null;
  }
  const fallback = output.split("\n")[0]?.trim();
  return fallback || null;
};

const getLlamacppRuntimeInfo = (config: Config): RuntimeBackendInfo => {
  const configured = config.llama_bin || "llama-server";
  const resolved =
    resolveBinary(configured) ?? (existsSync(configured) ? resolve(configured) : null);
  const binary = resolved ?? configured;

  const versionResult = runCommand(binary, ["--version"]);
  if (versionResult.status !== 0) {
    const helpResult = runCommand(binary, ["--help"]);
    if (helpResult.status !== 0) {
      return {
        installed: false,
        version: null,
        binary_path: resolved,
      };
    }
    const version = parseLlamaVersion(helpResult.stdout) ?? parseLlamaVersion(helpResult.stderr);
    return {
      installed: Boolean(version),
      version,
      binary_path: resolved,
    };
  }

  const version = parseLlamaVersion(versionResult.stdout) ?? parseLlamaVersion(versionResult.stderr);
  return {
    installed: Boolean(version),
    version,
    binary_path: resolved,
  };
};

export const getSystemRuntimeInfo = async (config: Config): Promise<SystemRuntimeInfo> => {
  const gpus = getGpuInfo();
  const types = Array.from(
    new Set(gpus.map((gpu) => gpu.name).filter((name) => name && name !== "Unknown"))
  );

  const [vllmInfo, sglangInfo] = await Promise.all([
    getVllmRuntimeInfo(),
    Promise.resolve(getSglangRuntimeInfo(config)),
  ]);

  const llamaInfo = getLlamacppRuntimeInfo(config);

  const pythonForTorch = config.sglang_python || vllmInfo.python_path || "python3";
  const torch = getTorchBuildInfo(pythonForTorch);

  const forcedSmiTool = process.env["VLLM_STUDIO_GPU_SMI_TOOL"];
  const hasNvidiaSmi = Boolean(resolveNvidiaSmiBinary());
  const rocmSmiTool = resolveRocmSmiTool();
  const hasRocmSmi = Boolean(rocmSmiTool);
  const kind = detectPlatformKind({ forcedSmiTool, torch, hasNvidiaSmi, hasRocmSmi });

  const platform: RuntimePlatformInfo = {
    kind,
    vendor: kind === "cuda" ? "nvidia" : kind === "rocm" ? "amd" : null,
    rocm: kind === "rocm" ? getRocmInfo(rocmSmiTool) : null,
    torch,
  };

  const gpuMonitoring = probeGpuMonitoring(kind, rocmSmiTool);

  return {
    platform,
    gpu_monitoring: gpuMonitoring,
    cuda: kind === "cuda" ? getCudaInfo() : { driver_version: null, cuda_version: null },
    gpus: {
      count: gpus.length,
      types,
    },
    backends: {
      vllm: {
        installed: vllmInfo.installed,
        version: vllmInfo.version,
        python_path: vllmInfo.python_path,
        binary_path: vllmInfo.vllm_bin,
      },
      sglang: sglangInfo,
      llamacpp: llamaInfo,
    },
  };
};
