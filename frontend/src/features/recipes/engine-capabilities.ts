import type { Backend } from "@/lib/types";
import type { RecipeModalTabId } from "./recipe-modal/tabs/tab-id";

export type ParallelismMode = "full" | "tp-pp" | "none";

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
}

const VLLM: EngineCapabilities = {
  backend: "vllm",
  tabs: ["general", "model", "resources", "performance", "features", "environment", "command"],
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
};

const SGLANG: EngineCapabilities = { ...VLLM, backend: "sglang" };

/** TabbyAPI takes a handful of stable flags; deeper tuning goes through extra args. */
const EXLLAMAV3: EngineCapabilities = {
  backend: "exllamav3",
  tabs: ["general", "model", "environment", "command"],
  contextLength: true,
  seed: false,
  advancedModelLoading: false,
  quantization: false,
  trustRemoteCode: false,
  parallelism: "none",
  gpuMemoryUtil: false,
  visibleDevices: true,
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
};

const CAPABILITIES: Record<Backend, EngineCapabilities> = {
  vllm: VLLM,
  sglang: SGLANG,
  exllamav3: EXLLAMAV3,
};

export const getEngineCapabilities = (backend: Backend | undefined): EngineCapabilities =>
  CAPABILITIES[backend ?? "vllm"] ?? VLLM;

/** A short, human-readable engine label. */
export const ENGINE_LABEL: Record<Backend, string> = {
  vllm: "vLLM",
  sglang: "SGLang",
  exllamav3: "exllamav3",
};
