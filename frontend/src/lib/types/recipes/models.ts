/**
 * Model discovery + recommendation types.
 */

export type { ModelInfo } from "../../../../../shared/contracts/recipes";

export interface StudioModelsRoot {
  path: string;
  exists: boolean;
  sources?: string[];
  recipe_ids?: string[];
}

export interface ModelRecommendation {
  id: string;
  name: string;
  size_gb: number | null;
  min_vram_gb: number | null;
  description: string;
  tags: string[];
}

export interface HuggingFaceModel {
  _id: string;
  modelId: string;
  downloads: number;
  likes: number;
  tags: string[];
  pipeline_tag?: string;
  library_name?: string;
  lastModified?: string;
  /** Hugging Face repo creation time (when returned by the API). */
  createdAt?: string;
  author?: string;
  private: boolean;
}
