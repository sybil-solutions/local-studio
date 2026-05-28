import type {
  CompatibilityReport,
  ConfigData,
  GPU,
  Metrics,
  ProcessInfo,
  UsageStats,
  VRAMCalculation,
} from "../types";
import type { ApiCore, RequestOptions } from "./core";

export function createSystemApi(core: ApiCore) {
  return {
    launch: (recipeId: string): Promise<{ success: boolean; pid?: number; message: string }> =>
      core.request(`/launch/${recipeId}`, {
        method: "POST",
        timeout: 30_000,
        retries: 0,
      }),

    evict: (): Promise<{ success: boolean; evicted_pid?: number }> =>
      core.request("/evict", { method: "POST" }),

    waitReady: (timeout = 300): Promise<{ ready: boolean; elapsed: number; error?: string }> =>
      core.request(`/wait-ready?timeout=${timeout}`),

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
      core.request("/v1/tokens/count", { method: "POST", body: JSON.stringify(data) }),

    getGPUs: (options?: RequestOptions): Promise<{ gpus: GPU[] }> => core.request("/gpus", options),

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
      maxTokens = 100,
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
      core.request(`/benchmark?prompt_tokens=${promptTokens}&max_tokens=${maxTokens}`, {
        method: "POST",
      }),

    getPeakMetrics: (
      modelId?: string,
    ): Promise<{
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
    }> => {
      const query = modelId ? `?model_id=${modelId}` : "";
      return core.request(`/peak-metrics${query}`);
    },

    getUsageStats: (): Promise<UsageStats> => core.request("/usage"),

    getPiSessionsUsageStats: (): Promise<UsageStats> => core.request("/usage/pi-sessions"),

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
