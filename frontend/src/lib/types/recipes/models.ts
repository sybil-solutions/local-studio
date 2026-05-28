/**
 * Model discovery + recommendation types.
 */

export interface ModelInfo {
  path: string;
  name: string;
  size_bytes?: number;
  modified_at?: number;
  architecture?: string | null;
  quantization?: string | null;
  context_length?: number | null;
  recipe_ids?: string[];
  has_recipe?: boolean;
  // KV cache calculation fields
  num_hidden_layers?: number | null;
  num_kv_heads?: number | null;
  hidden_size?: number | null;
  head_dim?: number | null;
}

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
