import type { Engine } from "./model";

export interface RecipeCaps {
  chat?: boolean;
  reasoning?: boolean;
  tools?: boolean;
  vision?: boolean;
  video?: boolean;
}

export interface RecipeWeights {
  repository: string;
  revision: string;
  sizeGb: number | null;
  layout: "dir" | "hub";
  mountPath: string;
  dir?: string | null;
  files?: string[] | null;
  hostPath?: string | null;
}

export interface RecipeLaunchV2 {
  entrypoint: string | null;
  arguments: string[];
  environment: Record<string, string>;
  port: number;
  shm: string | null;
}

export interface Recipe {
  id: string;
  name: string;
  family: string | null;
  hardwareId: string;
  cards: number;
  engine: Engine | string;
  format: string;
  servedName: string;
  sizeGb: number | null;
  image: string;
  minDriver: string | null;
  weights: RecipeWeights[];
  asset: { name: string; mountPath: string; text: string } | null;
  scratch: string | null;
  launch: RecipeLaunchV2;
  ctxTokens: number | null;
  kvTokens: number | null;
  caps: RecipeCaps;
  recommended: boolean;
  source?: "local";
}

export interface RecipeCatalog {
  source: string;
  registryCommit: string | null;
  generatedAt: string | null;
  fetchedAt: number;
  hardware: { hardwareId: string; match: { backend: string; name: string; names: string[]; vramGb: number } }[];
  recipes: Recipe[];
}

export type RecipeFit = "fits" | "busy" | "no-hardware" | "too-few-gpus";

export interface RecipeRow extends Recipe {
  fit: RecipeFit;
  freeGroups: string[][];
  runningModelId: string | null;
  weightsPresent: boolean | null;
  assigned?: boolean;
}

export interface LaunchMount {
  source: string;
  target: string;
  readOnly: boolean;
}

export interface LaunchPlan {
  recipeId: string;
  containerName: string;
  image: string;
  entrypoint: string | null;
  args: string[];
  env: Record<string, string>;
  mounts: LaunchMount[];
  gpuUuids: string[];
  gpuKeys: string[];
  hostPort: number;
  containerPort: number;
  shm: string | null;
  dockerOpts?: string[];
  labels: Record<string, string>;
  servedName: string;
  injected: string[];
}

export type LaunchPhase = "planning" | "weights" | "pulling" | "starting" | "loading" | "ready" | "failed" | "cancelled";

export interface LaunchProgress {
  launchId: string;
  recipeId: string;
  modelId: string | null;
  phase: LaunchPhase;
  percent: number | null;
  detail: string;
  error: string | null;
  startedAt: number;
  updatedAt: number;
  gpuKeys?: string[];
  machineId?: string;
}

export interface RecipeExport {
  modelId: string;
  recipeId: string;
  record: Record<string, unknown>;
  doc: string;
  refusals: string[];
  warnings: string[];
  launchable: boolean;
  savedTo: string;
}

export interface RecipePr {
  url: string;
  branch: string;
  files: string[];
}

export interface LaunchWeights {
  repository: string;
  revision: string;
  hostPath: string;
  present: boolean;
  source: string;
  hint: string | null;
}

export interface LaunchPreview {
  plan: LaunchPlan;
  dockerArgv: string[];
  dockerArgvSource: "lifecycle" | "recipes-preview";
  weights: LaunchWeights[];
  warnings: string[];
  executed: false;
}
