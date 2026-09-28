export type Backend = "nvidia" | "amd-rocm" | "amd-vulkan" | "amd-npu" | "intel-xpu" | "metal";

export interface Card {
  id: string;
  name: string;
  vendor: string;
  backend: Backend;
  vram_gb: number;
  bandwidth_gb_s?: number;
  match: { backend: Backend; name: string; names: string[]; vramGb: number };
}

export interface Weight {
  repo: string;
  revision: string;
  at: string;
  layout?: "dir" | "hub";
  files?: string | null;
}

export type Value = string | number | boolean;

export interface Profile {
  id: string;
  kind?: "host";
  engine?: string;
  about?: string;
  backend?: Backend | null;
  port: number;
  image?: string | null;
  entrypoint?: string | string[] | null;
  args?: string[];
  env?: Record<string, string>;
  shm?: string | null;
  flags?: string[];
  machines?: number;
  cards?: number;
  build?: unknown;
  setup?: string;
  source?: string;
  min_cuda?: number;
  weights?: Weight[];
  weights_at?: string;
  weights_files?: string;
  config_at?: string;
  config?: string[] | { at: string; text: string } | { at: string; file: string } | null;
  defaults?: Record<string, Value>;
  ctx: number;
  seqs?: number;
  vision?: boolean;
  command?: string[];
  install?: string | null;
  pip?: string[];
  wired_limit_reserve_mb?: number;
  plugin?: { name?: string; family?: string; format?: string; servedName?: string; sizeGb?: number; minDriver?: string; serving?: { kvTokens?: number } };
  ids?: Record<string, string>;
  frozen_from?: string[];
}

export interface Proof {
  at: string | null;
  on: string;
  gpu?: string | null;
  gates: string;
  tps: number | null;
  prefill?: number | null;
  served?: string;
  log?: string;
  legacy?: boolean;
  proxy?: string;
  reported?: boolean;
  src?: string;
}

export interface Recipe {
  model: string;
  weights: string;
  engine: string;
  set: Record<string, Value>;
  card: string;
  proof: Proof[];
}

export interface ConfigFile {
  at: string;
  text: string;
  sha256: string;
}

interface LaunchBase {
  port: number;
  env: Record<string, string>;
  weights: Weight[];
  config: ConfigFile | null;
  ctx: number;
  seqs: number;
  vision: boolean;
  backend: Backend | null;
  cards: number;
  setup?: string;
  source?: string;
}

export interface ContainerLaunch extends LaunchBase {
  kind: "container";
  image: string | null;
  entrypoint: string | string[] | null;
  args: string[];
  shm: string | null;
  flags: string[];
  machines: number;
  min_cuda?: number;
  build?: unknown;
}

export interface HostLaunch extends LaunchBase {
  kind: "host";
  command: string[];
  install: string | null;
  pip: string[];
  sysctl?: Record<string, number>;
}

export type Launch = ContainerLaunch | HostLaunch;

export interface Model {
  family?: string;
  name?: string;
  released?: string;
  reasoning?: boolean;
  vision?: boolean;
  about?: string;
}

export interface Tree {
  cards: Map<string, Card>;
  engines: Map<string, Profile>;
  launches: Map<string, Profile>;
  files: Map<string, string>;
  recipes: Map<string, Recipe>;
  models: Record<string, Model>;
  builds: Record<string, { format: string; size_gb: number }>;
}

export const GATES = ["load", "chat", "reasoning", "tools", "context", "speed"] as const;
export type Gate = (typeof GATES)[number];
export const MIN_TPS = 15;
export const MAX_RECIPE_BYTES = 1024;

export class RegistryError extends Error {}
