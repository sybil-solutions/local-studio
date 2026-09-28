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

export interface RecipeProof {
  at: string | null;
  on: string;
  gpu?: string | null;
  gates: string;
  tps: number | null;
  prefill?: number | null;
  served?: string;
  legacy?: boolean;
  proxy?: string;
  reported?: boolean;
  src?: string;
  log?: string;
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
  origin?: "yours" | "registry";
  key?: string | null;
  profile?: string | null;
  machines?: number;
  flags?: string[];
  proof?: RecipeProof | null;
  runtime?: "container" | "host";
  blocked?: string | null;
  publisher?: string | null;
}

export interface RecipeCatalog {
  source: string;
  ref?: string;
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

export interface RecipeStop {
  machineId: string;
  gpuKeys: string[];
  state: "running" | "busy" | "foreign";
  modelId: string | null;
}

export interface SelectionRow extends RecipeRow {
  stops: RecipeStop[];
}

export interface SelectionFit {
  machines: { machineId: string; name: string; gpuKeys: string[]; hardwareIds: string[] }[];
  rows: SelectionRow[];
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
  host?: HostPlan;
  downloads?: { repository: string; argv: string[]; dir?: string; bytes?: number }[];
  hostNetwork?: boolean;
  worker?: boolean;
}

export interface HostPlan {
  command: string[];
  cwd: string;
  env: Record<string, string>;
  pip: string[];
  files: { path: string; text: string }[];
  links: { path: string; target: string }[];
  sysctl: Record<string, number>;
  install: string | null;
  log: string;
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
  profile: Record<string, unknown> | null;
  files: Record<string, string>;
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
  worktree?: string;
  check?: string;
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
  stops?: RecipeStop[];
  executed: false;
}
