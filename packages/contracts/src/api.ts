import { z } from "zod";
import { HARNESSES } from "./agent";

export const ConnectPeerBody = z.object({
  url: z.string().url(),
  key: z.string().min(16).optional(),
  name: z.string().min(1).max(64).optional(),
});
export type ConnectPeerBody = z.infer<typeof ConnectPeerBody>;

const GpuKeys = z.array(z.string().regex(/^(nvidia|apple|intel|amd):[0-9]{1,2}$/)).min(1).max(8);

export const PodRank = z.object({
  id: z.string().regex(/^[a-z0-9]{4,16}$/),
  rank: z.number().int().min(0).max(15),
  size: z.number().int().min(2).max(16),
  vars: z.record(z.string().regex(/^[A-Z][A-Z0-9_]{0,31}$/), z.string().max(200)),
});
export type PodRank = z.infer<typeof PodRank>;

export const LaunchRecipeBody = z.object({
  gpuKeys: GpuKeys.optional(),
  stop: z.boolean().optional(),
  pod: PodRank.optional(),
});

export const PodLaunchBody = z.object({
  recipeId: z.string().min(1).max(200),
  machineIds: z.array(z.string().min(1).max(64)).min(2).max(16),
});
export type LaunchRecipeBody = z.infer<typeof LaunchRecipeBody>;

export const FitBody = z.object({
  selection: z.array(z.object({ machineId: z.string().min(1).max(64).optional(), gpuKeys: GpuKeys })).min(1).max(16),
});
export type FitBody = z.infer<typeof FitBody>;

export const SyncRecipesBody = z.object({
  ref: z.string().regex(/^[\w][\w./-]{0,199}$/).refine((r) => !r.includes("..")).optional(),
});
export type SyncRecipesBody = z.infer<typeof SyncRecipesBody>;

export const StopModelBody = z.object({
  confirm: z.string().min(1),
  force: z.boolean().optional(),
});
export type StopModelBody = z.infer<typeof StopModelBody>;

export const ExportPrBody = z.object({
  title: z.string().max(200).optional(),
  draft: z.boolean().default(true),
  dryRun: z.boolean().optional(),
});
export type ExportPrBody = z.infer<typeof ExportPrBody>;

export const AgentLaunchBody = z.object({
  harness: z.enum(HARNESSES),
  model: z.string().min(1).max(200),
  dir: z.string().min(1).max(1024).optional(),
  safe: z.boolean().optional(),
});
export type AgentLaunchBody = z.infer<typeof AgentLaunchBody>;

export const IssueKeyBody = z.object({
  client: z.string().regex(/^[a-z][a-z0-9-]{1,31}$/),
  label: z.string().max(64).optional(),
  scope: z.enum(["client", "federation"]).optional(),
  actions: z.boolean().optional(),
});
export type IssueKeyBody = z.infer<typeof IssueKeyBody>;

export const PriceBody = z.object({
  model: z.string().min(1),
  input: z.number().min(0),
  output: z.number().min(0),
  cacheRead: z.number().min(0),
  cacheWrite: z.number().min(0),
});
export type PriceBody = z.infer<typeof PriceBody>;

export const WindowParam = z.enum(["1h", "24h", "7d", "30d", "all"]).default("24h");


export const T3StartBody = z.object({
  host: z.string().regex(/^[0-9a-fA-F:.]{2,45}$/).optional(),
  port: z.number().int().min(1024).max(65535).optional(),
  cwd: z.string().min(1).max(1024).optional(),
});
export type T3StartBody = z.infer<typeof T3StartBody>;

export const T3PairBody = z.object({
  ttlMinutes: z.number().int().min(1).max(1440).optional(),
  label: z.string().min(1).max(64).optional(),
});
export type T3PairBody = z.infer<typeof T3PairBody>;
