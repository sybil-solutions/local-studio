import { z } from "zod";
import { HARNESSES } from "./agent";

export const ConnectPeerBody = z.object({
  url: z.string().url(),
  key: z.string().min(16),
  name: z.string().min(1).max(64).optional(),
});
export type ConnectPeerBody = z.infer<typeof ConnectPeerBody>;

export const LaunchRecipeBody = z.object({
  gpuKeys: z.array(z.string().regex(/^(nvidia|apple|intel):[0-9]{1,2}$/)).min(1).max(8).optional(),
});
export type LaunchRecipeBody = z.infer<typeof LaunchRecipeBody>;

export const StopModelBody = z.object({
  confirm: z.string().min(1),
  force: z.boolean().optional(),
});
export type StopModelBody = z.infer<typeof StopModelBody>;

export const ExportPrBody = z.object({
  title: z.string().max(200).optional(),
  draft: z.boolean().default(true),
});
export type ExportPrBody = z.infer<typeof ExportPrBody>;

export const AgentLaunchBody = z.object({
  workspaceId: z.string().regex(/^ws_[0-9a-f]{8}$/).optional(),
  name: z.string().min(1).max(64).optional(),
  dir: z.string().min(1).optional(),
  harness: z.enum(HARNESSES),
  model: z.string().min(1).max(200),
  safe: z.boolean().optional(),
  resume: z.boolean().optional(),
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

