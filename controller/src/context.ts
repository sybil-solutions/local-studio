import type { TailId } from "./federation/tailid";
import type { Database } from "bun:sqlite";
import type { Hono } from "hono";
import type {
  AgentSession,
  Activity,
  EngineRates,
  FleetSnapshot,
  GatewayModel,
  Gpu,
  GpuGroup,
  HarnessInfo,
  HostResources,
  LaunchPlan,
  LaunchProgress,
  Machine,
  MetricsSummary,
  ModelCardStats,
  Peer,
  RecipeCatalog,
  RecipeExport,
  RecipePr,
  RecipeRow,
  RequestRecord,
  RunningModel,
  Snapshot,
  Window,
  Endpoint,
} from "@local-studio/contracts";
import type { AuthVars } from "./core/auth";
import type { Bus } from "./core/bus";
import type { Config } from "./core/config";
import type { exec, fetchWithTimeout } from "./core/exec";
import type { Identity } from "./core/identity";
import type { KeyStore } from "./core/keys";
import type { Log } from "./core/log";
import type { Obs } from "./core/obs";

export interface Ctx {
  config: Config;
  db: Database;
  bus: Bus;
  log: Log;
  obs: Obs;
  keys: KeyStore;
  identity: Identity;
  exec: typeof exec;
  fetch: typeof fetchWithTimeout;
  tail: TailId;
}

export type Env = { Variables: AuthVars };
export type Router = Hono<Env>;

export interface RuntimeView {
  gpus: Gpu[];
  groups: GpuGroup[];
  models: RunningModel[];
  endpoints: Endpoint[];
  discovery: Snapshot["discovery"];
}

export interface DockerInspect {
  Id: string;
  Name: string;
  Image: string;
  Config: { Image: string; Cmd: string[] | null; Entrypoint: string[] | null; Env: string[] | null; Labels: Record<string, string> | null; ExposedPorts?: Record<string, unknown> | null };
  HostConfig: {
    ShmSize?: number;
    IpcMode?: string;
    NetworkMode?: string;
    PortBindings?: Record<string, { HostIp: string; HostPort: string }[]> | null;
    DeviceRequests?: { Driver: string; Count: number; DeviceIDs: string[] | null; Capabilities: string[][] }[] | null;
    Devices?: { PathOnHost: string }[] | null;
    SecurityOpt?: string[] | null;
    Ulimits?: { Name: string; Soft: number; Hard: number }[] | null;
  };
  Mounts: { Type: string; Source: string; Destination: string; RW: boolean }[];
  State: { Status: string; Running: boolean; Pid: number; StartedAt: string; Health?: { Status: string } };
}

export interface RuntimeService {
  view(): RuntimeView;
  machine(): Machine;
  host(): HostResources | null;
  models(): RunningModel[];
  model(id: string): RunningModel | undefined;
  resolveServed(name: string): RunningModel | undefined;
  rescan(): Promise<RuntimeView>;
}

export interface LifecycleService {
  dockerArgv(plan: LaunchPlan): string[];
  launch(plan: LaunchPlan): LaunchProgress;
  progress(): LaunchProgress[];
  cancel(launchId: string): boolean;
  stop(modelId: string, opts: { confirm: string; force?: boolean }): Promise<{ ok: boolean; detail: string }>;
  inspect(modelId: string): Promise<DockerInspect | null>;
  hostArgv(modelId: string): Promise<string[] | null>;
  imageEnv(image: string): Promise<string[]>;
  imageEntrypoint(image: string): Promise<string[] | null>;
  imageDigest(image: string): Promise<string | null>;
}

export interface RequestHandle {
  id: string;
  modelId: string | null;
  tsStart: number;
}

export type FinishDraft = Omit<RequestRecord, "id" | "cacheSource" | "engineQueueMs" | "enginePrefillMs" | "engineDecodeMs"> & { id?: string; cachedReported?: boolean };

export interface MetricsService {
  begin(modelId: string | null, tsStart: number): Promise<RequestHandle>;
  preview(h: RequestHandle, draft: FinishDraft): RequestRecord;
  finish(h: RequestHandle, draft: FinishDraft): Promise<RequestRecord>;
  summary(window: Window, filter?: { model?: string; client?: string; machineId?: string }): MetricsSummary;
  recent(limit: number, before?: number): RequestRecord[];
  engineRates(): EngineRates[];
  activity(): Activity;
  cards(): ModelCardStats[];
}

export interface GatewayService {
  models(): GatewayModel[];
}

export interface PeerService {
  list(): Peer[];
  get(id: string): Peer | undefined;
  fetch(id: string, path: string, init?: RequestInit & { timeoutMs?: number }): Promise<Response>;
  models(): GatewayModel[];
  fleet(): FleetSnapshot;
}

export interface RecipeService {
  catalog(): Promise<RecipeCatalog>;
  rows(): Promise<RecipeRow[]>;
  launch(recipeId: string, gpuKeys?: string[], stop?: boolean): Promise<LaunchProgress>;
  exportModel(modelId: string): Promise<RecipeExport>;
  openPr(modelId: string, opts: { title?: string; draft: boolean; dryRun?: boolean }): Promise<RecipePr>;
}

export interface AgentService {
  harnesses(): HarnessInfo[];
  sessions(): AgentSession[];
}

export interface Services {
  runtime: RuntimeService;
  lifecycle: LifecycleService;
  metrics: MetricsService;
  gateway: GatewayService;
  peers: PeerService;
  recipes: RecipeService;
  agents: AgentService;
}

export interface Module<S> {
  service: S;
  routes?: Router;
  start?(): void | Promise<void>;
  stop?(): void | Promise<void>;
}
