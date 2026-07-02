import type { Backend } from "@/lib/types";
import { LLAMACPP_OPTIONS, type LlamacppOption } from "./llamacpp-options";
import { MLX_OPTIONS } from "./mlx-options";
import type { RecipeModalTabId } from "./recipe-modal/tabs/tab-id";

export type ParallelismMode = "full" | "tp-pp" | "none";
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

  // Model tab
  contextLength: boolean;
  seed: boolean;
  advancedModelLoading: boolean; // tokenizer, revision, load-format, quant param path
  quantization: boolean; // quantization + dtype
  trustRemoteCode: boolean;

  // Resources tab
  parallelism: ParallelismMode;
  gpuMemoryUtil: boolean;
  visibleDevices: boolean;
  memoryManagement: boolean; // swap / cpu offload / gpu blocks override

  // Performance tab
  kvCacheDtype: boolean;
  blockSize: boolean;
  caching: boolean; // prefix caching + chunked prefill
  schedulerAdvanced: boolean; // batched tokens, scheduling policy, paddings
  maxNumSeqs: boolean;
  cudaGraphs: boolean;

  // Features tab
  toolCalling: boolean;
  reasoning: boolean;
  chatTemplates: boolean;

  // Environment tab
  pythonPath: boolean;
}

const VLLM: EngineCapabilities = {
  backend: "vllm",
  tabs: ["general", "model", "resources", "performance", "features", "environment", "command"],
  options: "none",
  contextLength: true,
  seed: true,
  advancedModelLoading: true,
  quantization: true,
  trustRemoteCode: true,
  parallelism: "full",
  gpuMemoryUtil: true,
  visibleDevices: true,
  memoryManagement: true,
  kvCacheDtype: true,
  blockSize: true,
  caching: true,
  schedulerAdvanced: true,
  maxNumSeqs: true,
  cudaGraphs: true,
  toolCalling: true,
  reasoning: true,
  chatTemplates: true,
  pythonPath: true,
};

const SGLANG: EngineCapabilities = { ...VLLM, backend: "sglang" };

const LLAMACPP: EngineCapabilities = {
  backend: "llamacpp",
  tabs: ["general", "model", "resources", "performance", "features", "environment", "command"],
  options: "llamacpp",
  contextLength: true,
  seed: true,
  advancedModelLoading: false,
  quantization: false,
  trustRemoteCode: false,
  parallelism: "none",
  gpuMemoryUtil: false,
  visibleDevices: false,
  memoryManagement: false,
  kvCacheDtype: false,
  blockSize: false,
  caching: false,
  schedulerAdvanced: false,
  maxNumSeqs: false,
  cudaGraphs: false,
  toolCalling: false,
  reasoning: false,
  chatTemplates: false,
  pythonPath: false,
};

const MLX: EngineCapabilities = {
  backend: "mlx",
  tabs: ["general", "model", "features", "environment", "command"],
  options: "mlx",
  contextLength: false,
  seed: false,
  advancedModelLoading: false,
  quantization: false,
  trustRemoteCode: true,
  parallelism: "none",
  gpuMemoryUtil: false,
  visibleDevices: false,
  memoryManagement: false,
  kvCacheDtype: false,
  blockSize: false,
  caching: false,
  schedulerAdvanced: false,
  maxNumSeqs: false,
  cudaGraphs: false,
  toolCalling: false,
  reasoning: false,
  chatTemplates: false,
  pythonPath: true,
};

const EXLLAMAV3: EngineCapabilities = {
  backend: "exllamav3",
  tabs: ["general", "model", "environment", "command"],
  options: "none",
  contextLength: false,
  seed: false,
  advancedModelLoading: false,
  quantization: false,
  trustRemoteCode: false,
  parallelism: "none",
  gpuMemoryUtil: false,
  visibleDevices: false,
  memoryManagement: false,
  kvCacheDtype: false,
  blockSize: false,
  caching: false,
  schedulerAdvanced: false,
  maxNumSeqs: false,
  cudaGraphs: false,
  toolCalling: false,
  reasoning: false,
  chatTemplates: false,
  pythonPath: true,
};

const CAPABILITIES: Record<Backend, EngineCapabilities> = {
  vllm: VLLM,
  sglang: SGLANG,
  llamacpp: LLAMACPP,
  mlx: MLX,
  exllamav3: EXLLAMAV3,
};

export const getEngineCapabilities = (backend: Backend | undefined): EngineCapabilities =>
  CAPABILITIES[backend ?? "vllm"] ?? VLLM;

/** Engine-native options (llama.cpp / MLX) for a given editor tab. */
export const getEngineOptions = (
  kind: EngineOptionsKind,
  tab: LlamacppOption["tab"],
): LlamacppOption[] => {
  const all = kind === "llamacpp" ? LLAMACPP_OPTIONS : kind === "mlx" ? MLX_OPTIONS : [];
  return all.filter((option) => option.tab === tab);
};

/** A short, human-readable engine label. */
export const ENGINE_LABEL: Record<Backend, string> = {
  vllm: "vLLM",
  sglang: "SGLang",
  llamacpp: "llama.cpp",
  mlx: "MLX",
  exllamav3: "ExLlamaV3",
};
