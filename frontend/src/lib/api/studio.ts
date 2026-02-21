// CRITICAL
import type {
  ModelDownload,
  ModelInfo,
  ModelRecommendation,
  StorageInfo,
  StudioDiagnostics,
  StudioModelsRoot,
  StudioSettings,
  RuntimeBackendInfo,
  RuntimeCommandPayload,
  RuntimeCudaInfo,
  RuntimeRocmInfo,
  RuntimeUpgradeResult,
  VllmRuntimeConfig,
  VllmRuntimeInfo,
  VllmUpgradeResult,
} from "../types";
import type { ApiCore } from "./core";
import { encodePathSegments } from "./core";

export function createStudioApi(core: ApiCore) {
  return {
    getModels: (): Promise<{
      models: ModelInfo[];
      roots?: StudioModelsRoot[];
      configured_models_dir?: string;
    }> => core.request("/v1/studio/models"),

    getStudioSettings: (): Promise<StudioSettings> => core.request("/studio/settings"),

    updateStudioSettings: (modelsDir: string): Promise<StudioSettings & { success: boolean }> =>
      core.request("/studio/settings", {
        method: "POST",
        body: JSON.stringify({ models_dir: modelsDir }),
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
      core.request("/studio/downloads", { method: "POST", body: JSON.stringify(params) }),

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

    getVllmRuntime: (): Promise<VllmRuntimeInfo> => core.request("/runtime/vllm"),

    getVllmRuntimeConfig: (): Promise<VllmRuntimeConfig> => core.request("/runtime/vllm/config"),

    getSglangRuntime: (): Promise<RuntimeBackendInfo> => core.request("/runtime/sglang"),

    getLlamacppRuntime: (): Promise<RuntimeBackendInfo> => core.request("/runtime/llamacpp"),

    getLlamacppRuntimeConfig: (): Promise<{ config: string | null; error?: string | null }> =>
      core.request("/runtime/llamacpp/config"),

    getCudaRuntime: (): Promise<RuntimeCudaInfo> => core.request("/runtime/cuda"),

    getRocmRuntime: (): Promise<RuntimeRocmInfo> => core.request("/runtime/rocm"),

    upgradeVllmRuntime: (preferBundled = true): Promise<VllmUpgradeResult> =>
      core.request("/runtime/vllm/upgrade", {
        method: "POST",
        body: JSON.stringify({ prefer_bundled: preferBundled }),
      }),

    upgradeSglangRuntime: (): Promise<RuntimeUpgradeResult> =>
      core.request("/runtime/sglang/upgrade", {
        method: "POST",
      }),

    upgradeLlamacppRuntime: (payload: RuntimeCommandPayload = {}): Promise<RuntimeUpgradeResult> =>
      core.request("/runtime/llamacpp/upgrade", {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    upgradeCudaRuntime: (payload: RuntimeCommandPayload = {}): Promise<RuntimeUpgradeResult> =>
      core.request("/runtime/cuda/upgrade", {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    upgradeRocmRuntime: (payload: RuntimeCommandPayload = {}): Promise<RuntimeUpgradeResult> =>
      core.request("/runtime/rocm/upgrade", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
  };
}
