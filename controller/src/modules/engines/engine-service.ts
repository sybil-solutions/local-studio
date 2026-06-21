import type { Recipe, ProcessInfo } from "../models/types";
import type { ModelDownload } from "../shared/recipe-types";

export type { Recipe, ProcessInfo };
export type { ModelDownload };

export interface DownloadRequest {
  model_id: string;
  revision?: string | null;
  destination_dir?: string | null;
  allow_patterns?: string[] | null;
  ignore_patterns?: string[] | null;
  hf_token?: string | null;
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
  setActiveRecipe(
    recipe: Recipe | null,
    options?: SetActiveRecipeOptions
  ): Promise<SetActiveRecipeResult>;
  ensureActive(recipe: Recipe, options?: EnsureActiveOptions): Promise<EnsureActiveResult>;
  resetLaunchFailureBudget(recipeId: string): void;

  getCurrentProcess(): Promise<ProcessInfo | null>;

  startDownload(request: DownloadRequest): Promise<ModelDownload>;
  pauseDownload(downloadId: string): ModelDownload;
  resumeDownload(downloadId: string, hfToken?: string | null): ModelDownload;
  cancelDownload(downloadId: string): ModelDownload;
  listDownloads(): ModelDownload[];
  getDownload(downloadId: string): ModelDownload | null;

  searchHuggingFace(query: string, hfToken?: string | null): Promise<HfModel[]>;
}
