import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type {
  ProcessInfo,
  RuntimeBackendInfo,
  RuntimeCudaInfo,
  RuntimePlatformInfo,
  RuntimePlatformKind,
  RuntimeTorchBuildInfo,
  SystemRuntimeInfo,
} from "../../models/types";
import type { Config } from "../../../config/env";
import { resolveBinary, runCommand } from "../../../core/command";
import { getGpuInfo } from "../../system/platform/gpu";
import { getVllmRuntimeInfo } from "./vllm-runtime";
import { probeGpuMonitoring } from "../../system/platform/compatibility-report";
import { getRocmInfo, resolveRocmSmiTool } from "../../system/platform/rocm-info";
import { resolveNvidiaSmiBinary } from "../../system/platform/smi-tools";
import { getTorchBuildInfo } from "../../system/platform/torch-info";
import { resolveVllmPythonPath } from "./vllm-python-path";
import { getEngineSpec } from "../engine-spec";
import {
  isUpgradeCommandConfigured,
  CUDA_UPGRADE_ENV,
  LLAMACPP_UPGRADE_ENV,
} from "./upgrade-config";

const SYSTEM_RUNTIME_CACHE_TTL_MS = 30_000;
let systemRuntimeCache: { expiresAt: number; value: SystemRuntimeInfo } | null = null;
let systemRuntimeInFlight: Promise<SystemRuntimeInfo> | null = null;

export const getSystemRuntimeInfo = async (
  config: Config,
  runningProcess?: ProcessInfo | null
): Promise<SystemRuntimeInfo> => {
  const now = Date.now();
  if (systemRuntimeCache && systemRuntimeCache.expiresAt > now) {
    return systemRuntimeCache.value;
  }
  if (systemRuntimeInFlight) return systemRuntimeInFlight;

  systemRuntimeInFlight = computeSystemRuntimeInfo(config, runningProcess)
    .then((value) => {
      systemRuntimeCache = { expiresAt: Date.now() + SYSTEM_RUNTIME_CACHE_TTL_MS, value };
      return value;
    })
    .finally(() => {
      systemRuntimeInFlight = null;
    });
  return systemRuntimeInFlight;
};

const computeSystemRuntimeInfo = async (
  config: Config,
  runningProcess?: ProcessInfo | null
): Promise<SystemRuntimeInfo> => {
  const gpus = getGpuInfo();
  const types = Array.from(
    new Set(gpus.map((gpu) => gpu.name).filter((name) => name && name !== "Unknown"))
  );
  const [vllmInfo, sglangInfo, llamaInfo, mlxInfo] = await Promise.all([
    getVllmRuntimeInfo(),
    getEngineSpec("sglang").getRuntimeInfo!(config, runningProcess),
    getEngineSpec("llamacpp").getRuntimeInfo!(config, runningProcess),
    getEngineSpec("mlx").getRuntimeInfo!(config, runningProcess),
  ]);
  const pythonForTorch = config.sglang_python || vllmInfo.python_path || "python3";
  const torch = getTorchBuildInfo(pythonForTorch);
  const forcedSmiTool = process.env["LOCAL_STUDIO_GPU_SMI_TOOL"];
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
    cuda:
      kind === "cuda"
        ? getCudaInfo()
        : { driver_version: null, cuda_version: null, upgrade_command_available: false },
    gpus: { count: gpus.length, types },
    backends: {
      vllm: {
        installed: vllmInfo.installed,
        version: vllmInfo.version,
        python_path: vllmInfo.python_path,
        binary_path: vllmInfo.vllm_bin,
        upgrade_command_available: Boolean(vllmInfo.python_path),
      },
      sglang: sglangInfo,
      llamacpp: llamaInfo,
      mlx: mlxInfo,
    },
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

const splitCommand = (command: string): string[] => {
  const tokens = command.match(/(?:[^\s"]+|"[^"]*"|'[^']*')+/g) ?? [];
  return tokens.map((token) => token.replace(/^['"]|['"]$/g, ""));
};

const resolvePythonCandidate = (candidate: string | null | undefined): string | null => {
  const value = candidate?.trim();
  if (!value) return null;
  if (value.includes("/")) return existsSync(value) ? resolve(value) : value;
  return resolveBinary(value) ?? value;
};

const looksLikePythonExecutable = (value: string): boolean => {
  const base = value.split("/").pop() ?? value;
  return /^python(?:\d+(?:\.\d+)?)?$/.test(base) || base.includes("python");
};

const getRunningSglangPythonCandidates = (
  runningProcess?: Pick<ProcessInfo, "pid" | "backend"> | null
): string[] => {
  if (!runningProcess || runningProcess.backend !== "sglang") return [];
  const result = runCommand("ps", ["-p", String(runningProcess.pid), "-o", "args="]);
  if (result.status !== 0 || !result.stdout) return [];
  const args = splitCommand(result.stdout.trim());
  const candidates: string[] = [];
  const first = args[0];
  if (first && looksLikePythonExecutable(first)) {
    const resolved = resolvePythonCandidate(first);
    if (resolved) candidates.push(resolved);
  }
  const moduleIndex = args.findIndex((argument) => argument === "sglang.launch_server");
  if (moduleIndex >= 2 && args[moduleIndex - 1] === "-m") {
    const resolved = resolvePythonCandidate(args[moduleIndex - 2]);
    if (resolved) candidates.push(resolved);
  }
  return candidates.filter((candidate, index, all) => all.indexOf(candidate) === index);
};

const SGLANG_IMPORT_PROBE =
  "import json, sys\ntry:\n import sglang\n print(json.dumps({'version': getattr(sglang, '__version__', None), 'python': sys.executable}))\nexcept Exception:\n print(json.dumps({'version': None, 'python': sys.executable}))";

export const getSglangRuntimeInfo = (
  config: Config,
  runningProcess?: Pick<ProcessInfo, "pid" | "backend"> | null
): RuntimeBackendInfo => {
  const candidates: string[] = getRunningSglangPythonCandidates(runningProcess);
  if (config.sglang_python) candidates.push(config.sglang_python);
  const canonical = resolveVllmPythonPath();
  if (canonical) candidates.push(canonical);
  candidates.push("python3", "python");
  const unique = candidates.filter((candidate, index, all) => all.indexOf(candidate) === index);

  for (const python of unique) {
    if (runCommand(python, ["-V"]).status !== 0) continue;
    const result = runCommand(python, ["-c", SGLANG_IMPORT_PROBE]);
    if (result.status !== 0) continue;
    let parsed: { version?: string | null; python?: string | null } | null = null;
    try {
      parsed = JSON.parse(result.stdout) as { version?: string | null; python?: string | null };
    } catch {
      continue;
    }
    if (parsed?.version) {
      return {
        installed: true,
        version: parsed.version,
        python_path: parsed.python ?? python,
        upgrade_command_available: true,
      };
    }
  }
  const fallback = unique.find((p) => runCommand(p, ["-V"]).status === 0) ?? null;
  return {
    installed: false,
    version: null,
    python_path: fallback ?? config.sglang_python ?? null,
    upgrade_command_available: Boolean(fallback),
  };
};

const MLX_IMPORT_PROBE =
  "import json, sys\ntry:\n import mlx_lm\n print(json.dumps({'version': getattr(mlx_lm, '__version__', None) or 'installed', 'python': sys.executable}))\nexcept Exception:\n print(json.dumps({'version': None, 'python': sys.executable}))";

const getRunningMlxPythonCandidates = (
  runningProcess?: Pick<ProcessInfo, "pid" | "backend"> | null
): string[] => {
  if (!runningProcess || runningProcess.backend !== "mlx") return [];
  const result = runCommand("ps", ["-p", String(runningProcess.pid), "-o", "args="]);
  if (result.status !== 0 || !result.stdout) return [];
  const args = splitCommand(result.stdout.trim());
  const candidates: string[] = [];
  const first = args[0];
  if (first && looksLikePythonExecutable(first)) {
    const resolved = resolvePythonCandidate(first);
    if (resolved) candidates.push(resolved);
  }
  const moduleIndex = args.findIndex((argument) => argument === "mlx_lm.server");
  if (moduleIndex >= 2 && args[moduleIndex - 1] === "-m") {
    const resolved = resolvePythonCandidate(args[moduleIndex - 2]);
    if (resolved) candidates.push(resolved);
  }
  return candidates.filter((candidate, index, all) => all.indexOf(candidate) === index);
};

export const getMlxRuntimeInfo = (
  config: Config,
  runningProcess?: Pick<ProcessInfo, "pid" | "backend"> | null
): RuntimeBackendInfo => {
  const candidates: string[] = getRunningMlxPythonCandidates(runningProcess);
  if (config.mlx_python) candidates.push(config.mlx_python);
  candidates.push("python3", "python");
  const unique = candidates.filter((candidate, index, all) => all.indexOf(candidate) === index);

  for (const python of unique) {
    if (runCommand(python, ["-V"]).status !== 0) continue;
    const result = runCommand(python, ["-c", MLX_IMPORT_PROBE]);
    if (result.status !== 0) continue;
    let parsed: { version?: string | null; python?: string | null } | null = null;
    try {
      parsed = JSON.parse(result.stdout) as { version?: string | null; python?: string | null };
    } catch {
      continue;
    }
    if (parsed?.version) {
      return {
        installed: true,
        version: parsed.version,
        python_path: parsed.python ?? python,
        upgrade_command_available: false,
      };
    }
  }
  const fallback = unique.find((p) => runCommand(p, ["-V"]).status === 0) ?? null;
  return {
    installed: false,
    version: null,
    python_path: fallback ?? config.mlx_python ?? null,
    upgrade_command_available: false,
  };
};

const parseLlamaVersion = (output: string): string | null => {
  if (!output) return null;
  const match = output.match(/version\s*[:=]\s*(\d+\s*\([^)]+\)|\S+)/i);
  if (match) return match[1]?.trim() ?? null;
  const fallback = output.split("\n")[0]?.trim();
  return fallback || null;
};

export const getLlamacppRuntimeInfo = (config: Config): RuntimeBackendInfo => {
  const configured = config.llama_bin || "llama-server";
  const resolved =
    resolveBinary(configured) ?? (existsSync(configured) ? resolve(configured) : null);
  const binary = resolved ?? configured;
  const versionResult = runCommand(binary, ["--version"]);
  if (versionResult.status !== 0) {
    const helpResult = runCommand(binary, ["--help"]);
    if (helpResult.status !== 0)
      return {
        installed: false,
        version: null,
        binary_path: resolved,
        upgrade_command_available: isUpgradeCommandConfigured(LLAMACPP_UPGRADE_ENV),
      };
    const version = parseLlamaVersion(helpResult.stdout) ?? parseLlamaVersion(helpResult.stderr);
    return {
      installed: Boolean(version),
      version,
      binary_path: resolved,
      upgrade_command_available: isUpgradeCommandConfigured(LLAMACPP_UPGRADE_ENV),
    };
  }
  const version =
    parseLlamaVersion(versionResult.stdout) ?? parseLlamaVersion(versionResult.stderr);
  return {
    installed: Boolean(version),
    version,
    binary_path: resolved,
    upgrade_command_available: isUpgradeCommandConfigured(LLAMACPP_UPGRADE_ENV),
  };
};

const extractCudaVersion = (output: string): string | null => {
  const match = output.match(/CUDA Version\s*:\s*([0-9.]+)/i);
  if (match) return match[1] ?? null;
  return null;
};

const extractNvccVersion = (output: string): string | null => {
  const match = output.match(/release\s+([0-9.]+)/i);
  if (match) return match[1] ?? null;
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
    upgrade_command_available: isUpgradeCommandConfigured(CUDA_UPGRADE_ENV),
  };
};
