// CRITICAL
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Config } from "../config/env";
import type { RuntimeBackendInfo, RuntimeCudaInfo, SystemRuntimeInfo } from "../types/models";
import { getGpuInfo } from "./gpu";
import { getVllmRuntimeInfo } from "./vllm-runtime";

type CommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

const DEFAULT_TIMEOUT_MS = 3_000;

const runCommand = (command: string, args: string[], timeoutMs = DEFAULT_TIMEOUT_MS): CommandResult => {
  try {
    const result = spawnSync(command, args, { timeout: timeoutMs, env: process.env });
    return {
      status: result.status,
      stdout: result.stdout ? result.stdout.toString("utf-8").trim() : "",
      stderr: result.stderr ? result.stderr.toString("utf-8").trim() : "",
    };
  } catch (error) {
    return {
      status: null,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
    };
  }
};

const resolveBinary = (binaryName: string): string | null => {
  if (!binaryName) {
    return null;
  }
  if (binaryName.includes("/")) {
    const resolved = resolve(binaryName);
    return existsSync(resolved) ? resolved : null;
  }
  const searchPaths: string[] = [];
  const runtimeOverride = process.env["VLLM_STUDIO_RUNTIME_BIN"];
  const runtimeBin = runtimeOverride ?? (process.env["SNAP"] ? resolve(process.cwd(), "runtime", "bin") : null);
  if (runtimeBin && existsSync(runtimeBin)) {
    searchPaths.push(runtimeBin);
  }
  const pathValue = process.env["PATH"];
  if (pathValue) {
    for (const entry of pathValue.split(":")) {
      if (entry) {
        searchPaths.push(entry);
      }
    }
  }
  const home = process.env["HOME"];
  if (home) {
    searchPaths.push(join(home, ".local", "bin"));
    searchPaths.push(join(home, "bin"));
  }
  const user = process.env["USER"] ?? process.env["LOGNAME"];
  if (user) {
    searchPaths.push(join("/home", user, ".local", "bin"));
    searchPaths.push(join("/home", user, "bin"));
  }
  for (const entry of searchPaths) {
    const candidate = join(entry, binaryName);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
};

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

  const driverResult = runCommand(nvidiaSmi, ["--query-gpu=driver_version", "--format=csv,noheader,nounits"]);
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
  const resolved = resolveBinary(configured) ?? (existsSync(configured) ? resolve(configured) : null);
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
  const types = Array.from(new Set(gpus.map((gpu) => gpu.name).filter((name) => name && name !== "Unknown")));

  const [vllmInfo, sglangInfo] = await Promise.all([
    getVllmRuntimeInfo(),
    Promise.resolve(getSglangRuntimeInfo(config)),
  ]);

  const llamaInfo = getLlamacppRuntimeInfo(config);

  return {
    cuda: getCudaInfo(),
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
