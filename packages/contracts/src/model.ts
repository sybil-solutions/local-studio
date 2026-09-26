import type { GpuKey } from "./gpu";
import type { MachineId } from "./machine";

export type Engine = "vllm" | "sglang" | "llamacpp" | "tabby" | "mlx" | "openai";

export type ModelState = "loading" | "ready" | "unhealthy" | "stopping";

export type ModelOrigin = "managed" | "adopted";

export type Dialect = "chat" | "responses" | "messages";

export type RuntimeRef =
  | {
      kind: "docker";
      containerId: string;
      containerName: string;
      image: string;
      imageDigest: string | null;
      statePid: number;
      labels: Record<string, string>;
      mounts: { source: string; target: string; readOnly: boolean }[];
    }
  | { kind: "native"; pid: number; startTime: string; exe: string }
  | { kind: "external"; note: string };

export interface CacheInfo {
  prefixCaching: boolean | null;
  blockSize: number | null;
  kvCacheTokens: number | null;
  kvCacheDtype: string | null;
  maxConcurrency: number | null;
}

export interface SpecDecodeInfo {
  method: string;
  numSpeculativeTokens: number | null;
}

export interface RunningModel {
  id: string;
  machineId: MachineId;
  engine: Engine;
  engineVersion: string | null;
  state: ModelState;
  stateSince: number;
  origin: ModelOrigin;
  recipeId: string | null;
  servedModels: string[];
  primaryModel: string;
  contextWindow: number | null;
  vision: boolean | null;
  port: number;
  baseUrl: string;
  metricsUrl: string | null;
  nativeDialects: Dialect[];
  runtime: RuntimeRef;
  argv: string[];
  gpuKeys: GpuKey[];
  vramUsedMiB: number | null;
  startedAt: number | null;
  cache: CacheInfo | null;
  spec: SpecDecodeInfo | null;
  watchdog: string | null;
  error: string | null;
  stopBlocked: string | null;
  embedding: boolean;
}

export type EndpointKind = "auth-proxy" | "openai-proxy" | "unknown-http";

export interface Endpoint {
  port: number;
  bind: string;
  kind: EndpointKind;
  pid: number | null;
  process: string | null;
  note: string;
}

export interface GatewayModel {
  id: string;
  machineId: MachineId;
  machineName: string;
  modelId: string;
  engine: Engine;
  state: ModelState;
  contextWindow: number | null;
  vision: boolean | null;
  via: "local" | "peer";
}
