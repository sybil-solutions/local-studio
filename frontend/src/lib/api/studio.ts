import type {
  ModelDownload,
  EngineJob,
  ModelInfo,
  ModelRecommendation,
  StorageInfo,
  StudioDiagnostics,
  StudioModelsRoot,
  StudioSettings,
  RuntimeBackendInfo,
  RuntimeCommandPayload,
  RuntimeCudaInfo,
  RuntimeJobResponse,
  RuntimeRocmInfo,
  RuntimeTarget,
  VllmRuntimeConfig,
  VllmRuntimeInfo,
} from "../types";
import { encodePathSegments, type ApiCore } from "./core";

export function createStudioApi(core: ApiCore) {
  return {
    getModels: (): Promise<{
      models: ModelInfo[];
      roots?: StudioModelsRoot[];
      configured_models_dir?: string;
    }> => core.request("/v1/studio/models"),

    getStudioSettings: (): Promise<StudioSettings> => core.request("/studio/settings"),

    updateStudioSettings: (payload: {
      models_dir?: string | null;
      ui_preferences?: Record<string, string> | null;
    }): Promise<StudioSettings & { success: boolean }> =>
      core.request("/studio/settings", {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    getStudioDiagnostics: (): Promise<StudioDiagnostics> => core.request("/studio/diagnostics"),

    getStudioStorage: (): Promise<StorageInfo> => core.request("/studio/storage"),

    getModelRecommendations: (): Promise<{
      recommendations: ModelRecommendation[];
      max_vram_gb: number;
    }> => core.request("/studio/recommendations"),

    getDownloads: (): Promise<{ downloads: ModelDownload[] }> => core.request("/studio/downloads"),

    startDownload: (params: {
      model_id: string;
      revision?: string;
      destination_dir?: string;
      allow_patterns?: string[];
      ignore_patterns?: string[];
      hf_token?: string;
    }): Promise<{ download: ModelDownload }> =>
      core.request("/studio/downloads", {
        method: "POST",
        body: JSON.stringify(params),
        timeout: 120_000,
        retries: 0,
      }),

    pauseDownload: (id: string): Promise<{ download: ModelDownload }> =>
      core.request(`/studio/downloads/${encodePathSegments(id)}/pause`, { method: "POST" }),

    resumeDownload: (id: string, hfToken?: string): Promise<{ download: ModelDownload }> =>
      core.request(`/studio/downloads/${encodePathSegments(id)}/resume`, {
        method: "POST",
        body: hfToken ? JSON.stringify({ hf_token: hfToken }) : "{}",
      }),

    cancelDownload: (id: string): Promise<{ download: ModelDownload }> =>
      core.request(`/studio/downloads/${encodePathSegments(id)}/cancel`, { method: "POST" }),

    deleteModel: (path: string): Promise<{ success: boolean }> =>
      core.request("/studio/models/delete", { method: "POST", body: JSON.stringify({ path }) }),

    moveModel: (
      sourcePath: string,
      targetRoot: string,
    ): Promise<{ success: boolean; target: string }> =>
      core.request("/studio/models/move", {
        method: "POST",
        body: JSON.stringify({ source_path: sourcePath, target_root: targetRoot }),
      }),

    getProviders: (): Promise<{
      providers: Array<{
        id: string;
        name: string;
        base_url: string;
        enabled: boolean;
        has_api_key: boolean;
      }>;
    }> => core.request("/studio/providers"),

    createProvider: (payload: {
      id: string;
      name: string;
      base_url: string;
      api_key: string;
      enabled?: boolean;
    }): Promise<{
      success: boolean;
      provider: {
        id: string;
        name: string;
        base_url: string;
        enabled: boolean;
        has_api_key: boolean;
      };
    }> =>
      core.request("/studio/providers", {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    updateProvider: (
      id: string,
      payload: {
        name?: string;
        base_url?: string;
        api_key?: string;
        enabled?: boolean;
      },
    ): Promise<{
      success: boolean;
      provider: {
        id: string;
        name: string;
        base_url: string;
        enabled: boolean;
        has_api_key: boolean;
      };
    }> =>
      core.request(`/studio/providers/${encodePathSegments(id)}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }),

    deleteProvider: (id: string): Promise<{ success: boolean }> =>
      core.request(`/studio/providers/${encodePathSegments(id)}`, {
        method: "DELETE",
      }),

    getProviderModels: (): Promise<{
      providers: Array<{
        provider: string;
        models: Array<{ id: string; name?: string }>;
      }>;
    }> => core.request("/studio/provider-models"),

    getVllmRuntime: (): Promise<VllmRuntimeInfo> => core.request("/runtime/vllm"),

    getRuntimeTargets: (): Promise<{ targets: RuntimeTarget[] }> =>
      core.request("/runtime/targets"),

    createRuntimeJob: (payload: {
      backend: "vllm" | "sglang" | "llamacpp" | "mlx";
      targetId?: string;
      type?: "install" | "update" | "download" | "inspect";
      command?: string;
      args?: string[];
      version?: string;
      preferBundled?: boolean;
    }): Promise<{ job: EngineJob }> =>
      core.request("/runtime/jobs", {
        method: "POST",
        body: JSON.stringify({
          backend: payload.backend,
          targetId: payload.targetId,
          type: payload.type,
          command: payload.command,
          args: payload.args,
          version: payload.version,
          prefer_bundled: payload.preferBundled,
        }),
      }),

    getRuntimeJobs: (): Promise<{ jobs: EngineJob[] }> => core.request("/runtime/jobs"),

    getRuntimeJob: (id: string): Promise<{ job: EngineJob }> =>
      core.request(`/runtime/jobs/${encodePathSegments(id)}`),

    cancelRuntimeJob: (id: string): Promise<{ job: EngineJob }> =>
      core.request(`/runtime/jobs/${encodePathSegments(id)}/cancel`, { method: "POST" }),

    getVllmRuntimeConfig: (): Promise<VllmRuntimeConfig> => core.request("/runtime/vllm/config"),

    getSglangRuntime: (): Promise<RuntimeBackendInfo> => core.request("/runtime/sglang"),

    getLlamacppRuntime: (): Promise<RuntimeBackendInfo> => core.request("/runtime/llamacpp"),

    getMlxRuntime: (): Promise<RuntimeBackendInfo> => core.request("/runtime/mlx"),

    getLlamacppRuntimeConfig: (): Promise<{ config: string | null; error?: string | null }> =>
      core.request("/runtime/llamacpp/config"),

    getCudaRuntime: (): Promise<RuntimeCudaInfo> => core.request("/runtime/cuda"),

    getRocmRuntime: (): Promise<RuntimeRocmInfo> => core.request("/runtime/rocm"),

    upgradeVllmRuntime: (
      payload: {
        preferBundled?: boolean;
        command?: string;
        args?: string[];
        version?: string;
      } = {},
    ): Promise<RuntimeJobResponse> =>
      core.request("/runtime/vllm/upgrade", {
        method: "POST",
        body: JSON.stringify({
          prefer_bundled: payload.preferBundled,
          command: payload.command,
          args: payload.args,
          version: payload.version,
        }),
      }),

    upgradeSglangRuntime: (payload: RuntimeCommandPayload = {}): Promise<RuntimeJobResponse> =>
      core.request("/runtime/sglang/upgrade", {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    upgradeLlamacppRuntime: (payload: RuntimeCommandPayload = {}): Promise<RuntimeJobResponse> =>
      core.request("/runtime/llamacpp/upgrade", {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    upgradeCudaRuntime: (payload: RuntimeCommandPayload = {}): Promise<RuntimeJobResponse> =>
      core.request("/runtime/cuda/upgrade", {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    upgradeRocmRuntime: (payload: RuntimeCommandPayload = {}): Promise<RuntimeJobResponse> =>
      core.request("/runtime/rocm/upgrade", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
  };
}
