import type { StudioDiagnostics, VllmUpgradeResult } from "@/lib/types";
import { formatBytes } from "./utils";

interface HardwareSummary {
  cpu: string;
  memory: string;
  gpu: string;
  runtime: string;
  vram: string;
}

interface UpgradeMessage {
  text: string;
  toneClassName: "text-(--err)" | "text-(--hl2)";
}

/**
 * Convert diagnostics into hardware copy for the setup UI.
 * @param diagnostics - Controller diagnostics, if loaded.
 * @returns Display strings for each hardware metric.
 */
export function buildHardwareSummary(diagnostics: StudioDiagnostics | null): HardwareSummary {
  const gpuNames = diagnostics?.gpus.map((gpu) => gpu.name).join(", ") || "No CUDA GPU detected";
  const firstGpuVramMb = diagnostics?.gpus[0]?.memory_total_mb ?? 0;

  return {
    cpu: `${diagnostics?.cpu_model ?? "Unknown"} · ${diagnostics?.cpu_cores ?? 0} cores`,
    gpu: gpuNames,
    memory: `${formatBytes(diagnostics?.memory_total ?? null)} total`,
    runtime: diagnostics?.runtime.vllm_installed
      ? `vLLM ${diagnostics.runtime.vllm_version ?? ""} detected.`
      : "vLLM runtime not detected. Install to continue.",
    vram: firstGpuVramMb ? `${Math.round(firstGpuVramMb / 1024)} GB` : "CPU only",
  };
}

/**
 * Convert an upgrade result into setup UI copy and tone.
 * @param upgradeResult - Runtime upgrade result, if present.
 * @returns Upgrade message copy and tone, or null when no result exists.
 */
export function buildUpgradeMessage(
  upgradeResult: VllmUpgradeResult | null,
): UpgradeMessage | null {
  if (!upgradeResult) {
    return null;
  }
  return {
    text: upgradeResult.success
      ? `Updated to vLLM ${upgradeResult.version}`
      : (upgradeResult.error ?? "Runtime upgrade failed."),
    toneClassName: upgradeResult.success ? "text-(--hl2)" : "text-(--err)",
  };
}
