import type { StudioDiagnostics } from "@/lib/types";
import { formatBytes } from "./utils";

interface HardwareSummary {
  cpu: string;
  memory: string;
  gpu: string;
  runtime: string;
  vram: string;
}

function isAppleSilicon(diagnostics: StudioDiagnostics | null): boolean {
  return Boolean(
    diagnostics?.platform === "darwin" &&
    (diagnostics.arch === "arm64" || /Apple M\d/i.test(diagnostics.cpu_model ?? "")),
  );
}

function runtimeDescription(diagnostics: StudioDiagnostics | null, appleSilicon: boolean): string {
  if (appleSilicon) return "Apple Silicon detected. Use MLX or llama.cpp with Metal acceleration.";
  if (diagnostics?.runtime.vllm_installed) {
    return `vLLM ${diagnostics.runtime.vllm_version ?? ""} detected.`;
  }
  return "Install a runtime supported by this controller to continue.";
}

/**
 * Convert diagnostics into hardware copy for the setup UI.
 * @param diagnostics - Controller diagnostics, if loaded.
 * @returns Display strings for each hardware metric.
 */
export function buildHardwareSummary(diagnostics: StudioDiagnostics | null): HardwareSummary {
  const appleSilicon = isAppleSilicon(diagnostics);
  const gpuNames =
    diagnostics?.gpus.map((gpu) => gpu.name).join(", ") ||
    (appleSilicon ? "Apple Silicon GPU · Metal" : "No accelerator detected");
  const firstGpuVramMb = diagnostics?.gpus[0]?.memory_total_mb ?? 0;

  return {
    cpu: `${diagnostics?.cpu_model ?? "Unknown"} · ${diagnostics?.cpu_cores ?? 0} cores`,
    gpu: gpuNames,
    memory: `${formatBytes(diagnostics?.memory_total ?? null)} total`,
    runtime: runtimeDescription(diagnostics, appleSilicon),
    vram: firstGpuVramMb
      ? `${Math.round(firstGpuVramMb / 1024)} GB${appleSilicon ? " unified" : ""}`
      : "Not reported",
  };
}
