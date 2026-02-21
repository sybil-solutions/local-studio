// CRITICAL
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { RuntimeRocmInfo, RuntimeRocmSmiTool } from "../types";
import { runCommand } from "../../../core/command";
import { resolveAmdSmiBinary, resolveForcedRocmTool, resolveRocmSmiBinary } from "./smi-tools";
import { ROCM_UPGRADE_ENV, isUpgradeCommandConfigured } from "../runtime-upgrade-config";

const parseHipccVersion = (output: string): string | null => {
  const match = output.match(/HIP version\s*:\s*([0-9.]+)/i);
  if (match) return match[1] ?? null;
  return null;
};

export const resolveRocmSmiTool = (): RuntimeRocmSmiTool | null => {
  const forced = resolveForcedRocmTool();
  if (forced) return forced;

  const amdSmi = resolveAmdSmiBinary();
  if (amdSmi) return "amd-smi";

  const rocmSmi = resolveRocmSmiBinary();
  if (rocmSmi) return "rocm-smi";

  return null;
};

const readRocmVersion = (): string | null => {
  const overridden = (process.env["VLLM_STUDIO_ROCM_VERSION_FILE"] ?? "").trim();
  if (overridden) {
    try {
      if (existsSync(overridden)) {
        return readFileSync(overridden, "utf-8").trim() || null;
      }
    } catch {
      // ignore
    }
  }

  const rocmInfoDirectory = "/opt/rocm/.info";
  const candidates: string[] = [resolve(rocmInfoDirectory, "version")];

  try {
    if (existsSync(rocmInfoDirectory)) {
      const entries = readdirSync(rocmInfoDirectory);
      for (const entry of entries) {
        if (entry.toLowerCase().startsWith("version")) {
          candidates.push(resolve(rocmInfoDirectory, entry));
        }
      }
    }
  } catch {
    // ignore
  }

  for (const filePath of candidates) {
    try {
      if (existsSync(filePath)) {
        const content = readFileSync(filePath, "utf-8").trim();
        if (content) return content;
      }
    } catch {
      // ignore
    }
  }

  return null;
};

export const getRocmInfo = (smiTool: RuntimeRocmSmiTool | null): RuntimeRocmInfo => {
  const rocmVersion = readRocmVersion();

  let hipVersion: string | null = null;
  const hipccResult = runCommand("hipcc", ["--version"]);
  if (hipccResult.status === 0) {
    hipVersion = parseHipccVersion(hipccResult.stdout) ?? parseHipccVersion(hipccResult.stderr) ?? null;
  }

  const gpuArch = new Set<string>();
  const rocminfoResult = runCommand("rocminfo", []);
  if (rocminfoResult.status === 0 && rocminfoResult.stdout) {
    const matches = rocminfoResult.stdout.match(/gfx[0-9a-f]+/gi) ?? [];
    for (const value of matches) {
      gpuArch.add(value.toLowerCase());
    }
  }

  return {
    rocm_version: rocmVersion,
    hip_version: hipVersion,
    smi_tool: smiTool,
    gpu_arch: Array.from(gpuArch),
    upgrade_command_available: isUpgradeCommandConfigured(ROCM_UPGRADE_ENV),
  };
};
