import { Schema } from "effect";
import {
  ModelIndexSchema,
  bundledModelIndexSource,
  type ModelIndexResponse,
} from "@local-studio/contracts/model-index";
import type { RuntimeJobBackend, RuntimeJobType } from "@local-studio/contracts/system";
import type {
  ModelDownload,
  EngineJob,
  ModelInfo,
  StarterPreset,
  StorageInfo,
  StudioDiagnostics,
  StudioSettings,
  RuntimeTarget,
} from "../types";
import { encodePathSegments, type ApiCore, type RequestOptions } from "./core";

export type {
  ModelIndexModel,
  ModelIndexResponse,
  ModelIndexTier,
  ModelIndexVariant,
  ModelIndexVariantFormat,
} from "@local-studio/contracts/model-index";

export interface StudioModelsRoot {
  path: string;
  exists: boolean;
  sources?: string[];
  recipe_ids?: string[];
}

export interface RuntimeJobResponse {
  job_id: string;
  job: EngineJob;
}

export type RuntimeJobPayload = {
  backend: RuntimeJobBackend;
  targetId?: string;
  type?: RuntimeJobType;
  version?: string;
  preferBundled?: boolean;
};

type RuntimeJobPayloadContract = RuntimeJobPayload &
  (Extract<keyof RuntimeJobPayload, "command" | "args"> extends never ? unknown : never);

const bundledModelIndex = Schema.decodeUnknownSync(ModelIndexSchema)(bundledModelIndexSource);

const hasStatus = (error: unknown, status: number): boolean =>
  error instanceof Error && (error as Error & { status?: number }).status === status;

export function createStudioApi(core: ApiCore) {
  return {
    getModels: (): Promise<{
      models: ModelInfo[];
      roots?: StudioModelsRoot[];
      configured_models_dir?: string;
    }> => core.request("/v1/studio/models"),

    getStudioSettings: (options?: RequestOptions): Promise<StudioSettings> =>
      core.request("/studio/settings", options),

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

    getModelIndex: async (options?: RequestOptions): Promise<ModelIndexResponse> => {
      try {
        const served = await core.request<ModelIndexResponse>("/studio/model-index", options);
        // The app ships its own copy of the catalog, and the controller is
        // deployed separately — so a freshly updated app would otherwise show a
        // stale set of picks until someone restarts the controller. Whichever
        // catalog carries the later `updated` date wins; ties go to the
        // controller, since that is where an operator's curated override lives.
        return served.updated >= bundledModelIndex.updated ? served : bundledModelIndex;
      } catch (error) {
        if (!hasStatus(error, 404)) throw error;
        return bundledModelIndex;
      }
    },

    getStarterPresets: (): Promise<{
      presets: StarterPreset[];
      max_vram_gb: number;
    }> => core.request("/studio/presets"),

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

    getRuntimeTargets: (): Promise<{ targets: RuntimeTarget[] }> =>
      core.request("/runtime/targets"),

    createRuntimeJob: (payload: RuntimeJobPayloadContract): Promise<{ job: EngineJob }> =>
      core.request("/runtime/jobs", {
        method: "POST",
        body: JSON.stringify({
          backend: payload.backend,
          targetId: payload.targetId,
          type: payload.type,
          version: payload.version,
          prefer_bundled: payload.preferBundled,
        }),
      }),

    getRuntimeJobs: (): Promise<{ jobs: EngineJob[] }> => core.request("/runtime/jobs"),

    getRuntimeJob: (id: string): Promise<{ job: EngineJob }> =>
      core.request(`/runtime/jobs/${encodePathSegments(id)}`),

    cancelRuntimeJob: (id: string): Promise<{ job: EngineJob }> =>
      core.request(`/runtime/jobs/${encodePathSegments(id)}/cancel`, { method: "POST" }),

    upgradeRuntime: (
      backend: "vllm" | "sglang" | "exllamav3",
      payload: { preferBundled?: boolean; version?: string; targetId?: string } = {},
    ): Promise<RuntimeJobResponse> =>
      core.request(`/runtime/${backend}/upgrade`, {
        method: "POST",
        body: JSON.stringify({
          prefer_bundled: payload.preferBundled,
          version: payload.version,
          targetId: payload.targetId,
        }),
      }),
  };
}
