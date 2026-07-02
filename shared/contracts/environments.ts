import type { EngineBackend } from "./system";

/** Engines with an official, pinned-version Docker image. MLX is Apple
 * Silicon (Metal) only — Docker on macOS runs in a Linux VM with no GPU
 * passthrough, so a containerized MLX environment would have no
 * acceleration and isn't offered. */
export type EnvironmentEngineId = Extract<EngineBackend, "vllm" | "sglang" | "llamacpp">;

/**
 * A pinned-version Docker environment for a recipe: which official upstream
 * image to run it in. Persisted definition only — container run/build status
 * is a runtime concern, tracked the same way a native recipe's running state
 * is (not stored on the record itself).
 */
export interface Environment {
  id: string;
  name: string;
  recipeId: string;
  engineId: EnvironmentEngineId;
  version: string;
  variant: string | null;
  createdAt: string;
  updatedAt: string;
}
