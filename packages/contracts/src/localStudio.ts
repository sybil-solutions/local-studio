import * as Schema from "effect/Schema";

export const LOCAL_STUDIO_CONTROLLER_HEADER = "x-local-studio-controller";

export const LocalGpu = Schema.Struct({
  index: Schema.Number,
  uuid: Schema.String,
  name: Schema.String,
  card: Schema.NullOr(Schema.String),
  memoryUsedMiB: Schema.Number,
  memoryTotalMiB: Schema.Number,
  utilization: Schema.NullOr(Schema.Number),
  temperatureC: Schema.NullOr(Schema.Number),
  powerW: Schema.NullOr(Schema.Number),
  busy: Schema.Boolean,
  jobId: Schema.NullOr(Schema.String),
});
export type LocalGpu = typeof LocalGpu.Type;

export const LocalHardware = Schema.Struct({
  hostname: Schema.String,
  platform: Schema.String,
  cpus: Schema.Number,
  loadAvg: Schema.Array(Schema.Number),
  memTotalBytes: Schema.Number,
  memFreeBytes: Schema.Number,
  gpus: Schema.Array(LocalGpu),
});
export type LocalHardware = typeof LocalHardware.Type;

export const LocalEndpoint = Schema.Struct({
  id: Schema.String,
  controllerId: Schema.String,
  port: Schema.Number,
  pid: Schema.NullOr(Schema.Number),
  process: Schema.NullOr(Schema.String),
  models: Schema.Array(Schema.String),
  live: Schema.Boolean,
  lastSeenAt: Schema.NullOr(Schema.String),
  jobId: Schema.NullOr(Schema.String),
});
export type LocalEndpoint = typeof LocalEndpoint.Type;

export const LocalUsage = Schema.Struct({
  model: Schema.String,
  requests: Schema.Number,
  lastAt: Schema.NullOr(Schema.String),
});
export type LocalUsage = typeof LocalUsage.Type;

export const LocalModel = Schema.Struct({
  id: Schema.String,
  live: Schema.Boolean,
  requests: Schema.Number,
  endpoints: Schema.Array(Schema.String),
  controllers: Schema.Array(Schema.String),
  recipes: Schema.Array(Schema.String),
});
export type LocalModel = typeof LocalModel.Type;

export const LocalControllerLink = Schema.Struct({
  id: Schema.NullOr(Schema.String),
  name: Schema.NullOr(Schema.String),
  url: Schema.String,
  self: Schema.Boolean,
  reachable: Schema.Boolean,
  depth: Schema.Number,
  error: Schema.NullOr(Schema.String),
});
export type LocalControllerLink = typeof LocalControllerLink.Type;

export const LocalJobPhase = Schema.Literals([
  "pending",
  "pulling",
  "downloading",
  "starting",
  "ready",
  "failed",
  "stopped",
]);
export type LocalJobPhase = typeof LocalJobPhase.Type;

export const LocalJob = Schema.Struct({
  id: Schema.String,
  recipeId: Schema.String,
  gpus: Schema.Array(Schema.Number),
  port: Schema.Number,
  container: Schema.String,
  phase: LocalJobPhase,
  progress: Schema.NullOr(Schema.Number),
  message: Schema.NullOr(Schema.String),
  startedAt: Schema.String,
  updatedAt: Schema.String,
});
export type LocalJob = typeof LocalJob.Type;

export const LocalRegistryInfo = Schema.Struct({
  source: Schema.String,
  ref: Schema.String,
  commit: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
});
export type LocalRegistryInfo = typeof LocalRegistryInfo.Type;

export const LocalControllerInfo = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  url: Schema.String,
  version: Schema.String,
});
export type LocalControllerInfo = typeof LocalControllerInfo.Type;

export const LocalSnapshot = Schema.Struct({
  controller: LocalControllerInfo,
  generatedAt: Schema.String,
  hardware: LocalHardware,
  auto: Schema.NullOr(Schema.String),
  endpoints: Schema.Array(LocalEndpoint),
  models: Schema.Array(LocalModel),
  controllers: Schema.Array(LocalControllerLink),
  jobs: Schema.Array(LocalJob),
  usage: Schema.Array(LocalUsage),
  registry: LocalRegistryInfo,
});
export type LocalSnapshot = typeof LocalSnapshot.Type;

export const LocalProofKind = Schema.Literals(["validated", "legacy", "reported"]);
export type LocalProofKind = typeof LocalProofKind.Type;

export const LocalCapture = Schema.Struct({
  manifest: Schema.String,
  host: Schema.String,
  decision: Schema.String,
  class: Schema.String,
  gaps: Schema.Array(Schema.String),
  file: Schema.String,
  sourceKind: Schema.String,
  rawSha256: Schema.NullOr(Schema.String),
});
export type LocalCapture = typeof LocalCapture.Type;

export const LocalRecipe = Schema.Struct({
  id: Schema.String,
  model: Schema.String,
  card: Schema.String,
  engine: Schema.String,
  cards: Schema.Number,
  ctx: Schema.Number,
  image: Schema.NullOr(Schema.String),
  servedName: Schema.NullOr(Schema.String),
  weights: Schema.String,
  status: Schema.Literals(["executable", "archived"]),
  reason: Schema.NullOr(Schema.String),
  proof: Schema.NullOr(
    Schema.Struct({
      kind: LocalProofKind,
      at: Schema.NullOr(Schema.String),
      gates: Schema.String,
      tps: Schema.NullOr(Schema.Number),
    }),
  ),
  freeGpus: Schema.Array(Schema.Number),
  runnable: Schema.Boolean,
  blocked: Schema.NullOr(Schema.String),
  capture: Schema.NullOr(LocalCapture),
});
export type LocalRecipe = typeof LocalRecipe.Type;

export const LocalRecipes = Schema.Struct({
  registry: LocalRegistryInfo,
  archivedRecords: Schema.Number,
  capturedConfigs: Schema.Number,
  recipes: Schema.Array(LocalRecipe),
});
export type LocalRecipes = typeof LocalRecipes.Type;

export const LocalRunRequest = Schema.Struct({
  gpus: Schema.optionalKey(Schema.Array(Schema.Number)),
  dryRun: Schema.optionalKey(Schema.Boolean),
});
export type LocalRunRequest = typeof LocalRunRequest.Type;

export const LocalRunResponse = Schema.Struct({
  job: Schema.NullOr(LocalJob),
  argv: Schema.Array(Schema.String),
});
export type LocalRunResponse = typeof LocalRunResponse.Type;

export const LocalPeerRequest = Schema.Struct({
  url: Schema.String,
  remove: Schema.optionalKey(Schema.Boolean),
});
export type LocalPeerRequest = typeof LocalPeerRequest.Type;

export const LocalHealth = Schema.Struct({
  ok: Schema.Boolean,
  id: Schema.String,
  name: Schema.String,
  version: Schema.String,
});
export type LocalHealth = typeof LocalHealth.Type;

export const LocalNode = Schema.Struct({
  controller: LocalControllerInfo,
  endpoints: Schema.Array(LocalEndpoint),
  usage: Schema.Array(LocalUsage),
  peers: Schema.Array(Schema.String),
});
export type LocalNode = typeof LocalNode.Type;

export const LocalError = Schema.Struct({
  error: Schema.Struct({ code: Schema.String, message: Schema.String }),
});
export type LocalError = typeof LocalError.Type;
