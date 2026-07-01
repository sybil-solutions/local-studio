import type { EngineBackend } from "./system";

export type EnvironmentEngineId = Extract<EngineBackend, "vllm" | "sglang" | "llamacpp">;

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
