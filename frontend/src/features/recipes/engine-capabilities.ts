import type { Backend } from "@/lib/types";
import { LLAMACPP_OPTIONS, type LlamacppOption } from "./llamacpp-options";
import { MLX_OPTIONS } from "./mlx-options";
import type { OptionTabId, RecipeSectionId } from "./recipe-option-sections";
import type { RecipeModalTabId } from "./recipe-modal/tabs/tab-id";

export type EngineOptionsKind = "none" | "llamacpp" | "mlx";

/**
 * Declarative description of what a given engine supports in the recipe editor.
 * The editor reads this so it only ever renders (and therefore only ever
 * persists) fields the selected engine actually understands. See
 * `shared/contracts/engine-args.ts` for the matching launch-time guard.
 */
export interface EngineCapabilities {
  backend: Backend;
  /** Tabs to render, in order. */
  tabs: RecipeModalTabId[];
  /** Engine-native option panel (llama.cpp / MLX) rendered in place of vLLM forms. */
  options: EngineOptionsKind;
  /** Recipe editor sections rendered per option tab, in order. */
  sections: Partial<Record<OptionTabId, readonly RecipeSectionId[]>>;
}

const ALL_TABS: RecipeModalTabId[] = [
  "general",
  "model",
  "resources",
  "performance",
  "features",
  "environment",
  "command",
];

const VLLM: EngineCapabilities = {
  backend: "vllm",
  tabs: ALL_TABS,
  options: "none",
  sections: {
    model: ["context", "weights"],
    resources: ["parallelism", "gpu", "memory"],
    performance: ["compilation", "kvCache", "scheduler"],
    features: ["modelInput", "toolCalling", "reasoning", "chatTemplates"],
  },
};

const SGLANG: EngineCapabilities = { ...VLLM, backend: "sglang" };

const LLAMACPP: EngineCapabilities = {
  backend: "llamacpp",
  tabs: ALL_TABS,
  options: "llamacpp",
  sections: { model: ["context"], features: ["modelInput"] },
};

const MLX: EngineCapabilities = {
  backend: "mlx",
  tabs: ["general", "model", "features", "environment", "command"],
  options: "mlx",
  sections: { model: ["weights"], features: ["modelInput"] },
};

const CAPABILITIES: Record<Backend, EngineCapabilities> = {
  vllm: VLLM,
  sglang: SGLANG,
  llamacpp: LLAMACPP,
  mlx: MLX,
};

export const getEngineCapabilities = (backend: Backend | undefined): EngineCapabilities =>
  CAPABILITIES[backend ?? "vllm"] ?? VLLM;

/** Engine-native options (llama.cpp / MLX) for a given editor tab. */
export const getEngineOptions = (
  kind: EngineOptionsKind,
  tab: LlamacppOption["tab"],
): LlamacppOption[] =>
  (kind === "llamacpp" ? LLAMACPP_OPTIONS : kind === "mlx" ? MLX_OPTIONS : []).filter(
    (option) => option.tab === tab,
  );

/** A short, human-readable engine label. */
export const ENGINE_LABEL: Record<Backend, string> = {
  vllm: "vLLM",
  sglang: "SGLang",
  llamacpp: "llama.cpp",
  mlx: "MLX",
};
