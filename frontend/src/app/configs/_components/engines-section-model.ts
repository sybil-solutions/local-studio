import type { RuntimeBackendInfo, RuntimeTarget, SystemRuntimeInfo } from "@/lib/types";

export const ENGINE_META: Record<string, { label: string; description: string }> = {
  vllm: {
    label: "vLLM",
    description: "High-throughput LLM serving with CUDA-oriented scheduling.",
  },
  sglang: { label: "SGLang", description: "Fast structured generation and multi-turn serving." },
  llamacpp: {
    label: "llama.cpp",
    description: "GGUF inference through CPU, Metal, or CUDA builds.",
  },
  mlx: { label: "MLX", description: "Apple Silicon inference through mlx-lm." },
  exllamav3: { label: "ExLlama v3", description: "EXL3 quantized inference target." },
};

export const FALLBACK_ENGINES = ["vllm", "sglang", "llamacpp", "mlx", "exllamav3"] as const;

export type EngineRowsView =
  | { kind: "backends"; rows: Array<{ id: string; info: RuntimeBackendInfo }> }
  | { kind: "pending"; engineIds: readonly string[] }
  | { kind: "targets"; targets: RuntimeTarget[] };

/**
 * Resolve which engine rows the settings page should render.
 * @param targets - Runtime targets returned by the controller.
 * @param backends - Runtime backend summary returned by the controller.
 * @returns A compact view model for the row renderer.
 */
export function resolveEngineRowsView(
  targets: RuntimeTarget[],
  backends: SystemRuntimeInfo["backends"] | undefined,
): EngineRowsView {
  const inferenceTargets = targets.filter(isInferenceTarget);
  if (inferenceTargets.length > 0) {
    return { kind: "targets", targets: inferenceTargets };
  }
  if (backends) {
    return {
      kind: "backends",
      rows: FALLBACK_ENGINES.flatMap((id) => {
        const info = backends[id];
        return info ? [{ id, info }] : [];
      }),
    };
  }
  return { kind: "pending", engineIds: FALLBACK_ENGINES };
}

export function hasHydratedEngineRows(view: EngineRowsView): boolean {
  return view.kind !== "pending";
}

function isInferenceTarget(target: RuntimeTarget): boolean {
  return (
    target.backend === "vllm" ||
    target.backend === "sglang" ||
    target.backend === "llamacpp" ||
    target.backend === "mlx"
  );
}
