import type {
  CompatibilityReport,
  ConfigData,
  GPU,
  Metrics,
  ProcessInfo,
  UsageStats,
  VRAMCalculation,
} from "../types";
import { encodePathSegments, type ApiCore, type RequestOptions } from "./core";

const MB = 1024 * 1024;
const GPU_BOOLEAN_KEYS = [
  "memory_shared",
  "memory_usage_available",
  "utilization_available",
  "temperature_available",
  "power_available",
] as const;

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function legacyMb(value: unknown): number | null {
  const bytes = finiteNumber(value);
  return bytes !== null && bytes > 0 ? bytes / MB : null;
}

function assignGpuMetadata(gpu: GPU, raw: Record<string, unknown>): void {
  if (typeof raw["id"] === "string") gpu.id = raw["id"];
  const powerDraw = finiteNumber(raw["power_draw"]);
  if (powerDraw !== null) gpu.power_draw = powerDraw;
  const powerLimit = finiteNumber(raw["power_limit"]);
  if (powerLimit !== null) gpu.power_limit = powerLimit;
  for (const key of GPU_BOOLEAN_KEYS) {
    const value = raw[key];
    if (typeof value === "boolean") gpu[key] = value;
  }
}

export function normalizeGpuAliases(list: unknown): GPU[] {
  if (!Array.isArray(list)) return [];
  const gpus: GPU[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as Record<string, unknown>;
    const gpu: GPU = {
      index: finiteNumber(raw["index"]) ?? 0,
      name: typeof raw["name"] === "string" ? raw["name"] : "GPU",
      memory_total_mb: finiteNumber(raw["memory_total_mb"]) ?? legacyMb(raw["memory_total"]) ?? 0,
      memory_used_mb: finiteNumber(raw["memory_used_mb"]) ?? legacyMb(raw["memory_used"]) ?? 0,
      memory_free_mb: finiteNumber(raw["memory_free_mb"]) ?? legacyMb(raw["memory_free"]) ?? 0,
      utilization_pct:
        finiteNumber(raw["utilization_pct"]) ?? finiteNumber(raw["utilization"]) ?? 0,
      temp_c: finiteNumber(raw["temp_c"]) ?? finiteNumber(raw["temperature"]) ?? 0,
    };
    assignGpuMetadata(gpu, raw);
    gpus.push(gpu);
  }
  return gpus;
}

export function createSystemApi(core: ApiCore) {
  return {
    launch: (recipeId: string): Promise<{ success: boolean; pid?: number; message: string }> =>
      core.request(`/launch/${encodePathSegments(recipeId)}`, {
        method: "POST",
        timeout: 360_000,
        retries: 0,
      }),

    evict: (): Promise<{ success: boolean; evicted_pid?: number }> =>
      core.request("/evict", { method: "POST" }),

    waitReady: (timeout = 300): Promise<{ ready: boolean; elapsed: number; error?: string }> =>
      core.request(`/wait-ready?timeout=${timeout}`, {
        timeout: (timeout + 15) * 1000,
        retries: 0,
      }),

    getOpenAIModels: (): Promise<{
      data: Array<{ id: string; root?: string; max_model_len?: number }>;
    }> => core.request("/v1/models"),

    tokenizeChatCompletions: (data: {
      model: string;
      messages: Record<string, unknown>[];
      tools?: Record<string, unknown>[];
    }): Promise<{ input_tokens?: number; breakdown?: { messages?: number; tools?: number } }> =>
      core.request("/v1/tokenize-chat-completions", {
        method: "POST",
        body: JSON.stringify(data),
      }),

    countTextTokens: (data: { model: string; text: string }): Promise<{ num_tokens?: number }> =>
      core.request("/v1/count-tokens", { method: "POST", body: JSON.stringify(data) }),

    getGPUs: async (options?: RequestOptions): Promise<{ gpus: GPU[] }> => {
      const payload = await core.request<{ gpus?: unknown }>("/gpus", options);
      return { gpus: normalizeGpuAliases(payload.gpus) };
    },

    calculateVRAM: (data: {
      model: string;
      context_length: number;
      tp_size: number;
      kv_dtype: string;
    }): Promise<VRAMCalculation> =>
      core.request("/vram-calculator", { method: "POST", body: JSON.stringify(data) }),

    getMetrics: (): Promise<Metrics> => core.request("/v1/metrics/vllm"),

    runBenchmark: (
      promptTokens = 1000,
    ): Promise<{
      success?: boolean;
      error?: string;
      model_id?: string;
      benchmark?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_time_s: number;
        prefill_tps: number;
        generation_tps: number;
        ttft_ms: number;
      };
      peak_metrics?: {
        prefill_tps: number;
        generation_tps: number;
        ttft_ms: number;
        total_tokens: number;
        total_requests: number;
      };
    }> =>
      core.request(`/benchmark?prompt_tokens=${promptTokens}`, {
        method: "POST",
      }),

    getPeakMetrics: (): Promise<{
      metrics?: Array<{
        model_id: string;
        prefill_tps: number;
        generation_tps: number;
        ttft_ms: number;
        best_session_id?: string | null;
        best_session_prefill_tps?: number | null;
        best_session_generation_tps?: number | null;
        best_session_ttft_ms?: number | null;
        total_tokens: number;
        total_requests: number;
      }>;
      error?: string;
    }> => core.request("/peak-metrics", { retries: 0 }),

    getUsageStats: (): Promise<UsageStats> => core.request("/usage", { retries: 0 }),

    getPiSessionsUsageStats: (): Promise<UsageStats> =>
      core.request("/usage/pi-sessions", { retries: 0 }),

    getStatus: async (
      options?: RequestOptions,
    ): Promise<{
      running: boolean;
      process: ProcessInfo | null;
      inference_port: number;
      launching: string | null;
    }> => {
      const data = await core.request<{
        running: boolean;
        process: ProcessInfo | null;
        inference_port: number;
        launching?: string | null;
      }>("/status", options);

      return {
        running: data.running ?? !!data.process,
        process: data.process ?? null,
        inference_port: data.inference_port || 8000,
        launching: typeof data.launching === "string" && data.launching ? data.launching : null,
      };
    },

    getSystemConfig: (options?: RequestOptions): Promise<ConfigData> =>
      core.request("/config", options),

    getCompatibility: (options?: RequestOptions): Promise<CompatibilityReport> =>
      core.request("/compat", options),
  };
}
