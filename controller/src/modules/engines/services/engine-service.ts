// Types needed by EngineService are defined below
import type { Recipe, ProcessInfo } from "../../models/types";
import type { ModelDownload } from "../../shared/recipe-types";

export type { Recipe, ProcessInfo };
export type { ModelDownload };

export type RuntimeType = "vllm" | "sglang" | "llamacpp" | "exllamav3" | "cuda" | "rocm";
export type RuntimeInfo = {
  installed: boolean;
  version: string | null;
  python_path?: string | null | undefined;
  binary_path?: string | null | undefined;
  upgrade_command_available: boolean;
};
export type UpgradeResult = {
  success: boolean;
  version: string | null;
  output: string | null;
  error: string | null;
  used_command: string | null;
};

export interface DownloadRequest {
  model_id: string;
  revision?: string | null;
  destination_dir?: string | null;
  allow_patterns?: string[] | null;
  ignore_patterns?: string[] | null;
  hf_token?: string | null;
}

export interface DownloadHandle {
  id: string;
  model_id: string;
  status: string;
}

export interface DownloadStatus {
  id: string;
  model_id: string;
  status: string;
  downloaded_bytes: number;
  total_bytes: number | null;
  error: string | null;
}

export interface HfModel {
  id: string;
  name?: string;
  description?: string;
}

export interface EnsureActiveResult {
  switched: boolean;
  error: string | null;
}

export interface EnsureActiveOptions {
  force_evict?: boolean;
  publish_events?: boolean;
}

export type SetActiveRecipeResult = { ok: true } | { ok: false; error: string };

/** Options for setting the active recipe. */
export interface SetActiveRecipeOptions {
  signal?: AbortSignal;
}

/**
 * The single public contract for the engines module.
 * All consumers (HTTP routes, other modules, tests) use this interface.
 */
export interface EngineService {
  // Lifecycle
  setActiveRecipe(recipe: Recipe | null, options?: SetActiveRecipeOptions): Promise<SetActiveRecipeResult>;
  ensureActive(recipe: Recipe, options?: EnsureActiveOptions): Promise<EnsureActiveResult>;

  // State queries
  getCurrentRecipe(): Recipe | null;
  getCurrentProcess(): Promise<ProcessInfo | null>;

  // Downloads
  startDownload(request: DownloadRequest): Promise<ModelDownload>;
  pauseDownload(downloadId: string): ModelDownload;
  resumeDownload(downloadId: string, hfToken?: string | null): ModelDownload;
  cancelDownload(downloadId: string): ModelDownload;
  listDownloads(): ModelDownload[];
  getDownload(downloadId: string): ModelDownload | null;

  // HuggingFace
  searchHuggingFace(query: string, hfToken?: string | null): Promise<HfModel[]>;

  // Runtimes
  listRuntimes(): Record<string, RuntimeInfo>;
  upgradeRuntime(runtime: RuntimeType, options?: { version?: string; args?: string[] }): Promise<UpgradeResult>;
  getRuntimeHelp(runtime: "vllm" | "llamacpp"): Promise<{ config: string | null; error: string | null }>;
}