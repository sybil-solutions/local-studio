import * as Schema from "effect/Schema";

export const LOCAL_STUDIO_CONTROLLER_HEADER = "x-local-studio-controller";

const OptionalString = Schema.NullOr(Schema.String);

export const LocalGpu = Schema.Struct({
  index: Schema.Number,
  name: Schema.String,
  card: OptionalString,
  memoryUsedMiB: Schema.Number,
  memoryTotalMiB: Schema.Number,
  busy: Schema.Boolean,
});
export type LocalGpu = typeof LocalGpu.Type;

export const LocalHardware = Schema.Struct({ cpus: Schema.Number, memTotalBytes: Schema.Number, memFreeBytes: Schema.Number, gpus: Schema.Array(LocalGpu) });
export type LocalHardware = typeof LocalHardware.Type;

export const LocalEndpoint = Schema.Struct({
  id: Schema.String,
  controllerId: Schema.String,
  port: Schema.Number,
  pid: Schema.NullOr(Schema.Number),
  models: Schema.Array(Schema.String),
  live: Schema.Boolean,
  lastSeenAt: OptionalString,
  jobId: OptionalString,
});
export type LocalEndpoint = typeof LocalEndpoint.Type;

export const LocalUsage = Schema.Struct({
  model: Schema.String,
  requests: Schema.Number,
  lastAt: OptionalString,
  measuredRequests: Schema.optionalKey(Schema.Number),
  tokens: Schema.optionalKey(Schema.Record(Schema.String, Schema.Number)),
});
export type LocalUsage = typeof LocalUsage.Type;

export const LocalControllerLink = Schema.Struct({
  id: OptionalString,
  name: OptionalString,
  url: Schema.String,
  self: Schema.Boolean,
  reachable: Schema.Boolean,
  error: OptionalString,
  usage: Schema.optionalKey(Schema.Array(LocalUsage)),
});
export type LocalControllerLink = typeof LocalControllerLink.Type;

export const LocalJob = Schema.Struct({
  id: Schema.String,
  recipeId: Schema.String,
  gpus: Schema.Array(Schema.Number),
  port: Schema.Number,
  container: Schema.String,
  phase: Schema.Literals(["pending", "pulling", "downloading", "starting", "ready", "failed", "stopped"]),
  progress: Schema.NullOr(Schema.Number),
  message: OptionalString,
  startedAt: Schema.String,
  updatedAt: Schema.String,
});
export type LocalJob = typeof LocalJob.Type;

const LocalControllerInfo = Schema.Struct({ id: Schema.String, name: Schema.String, url: Schema.String, version: Schema.String });

export const LocalSnapshot = Schema.Struct({
  controller: LocalControllerInfo,
  generatedAt: Schema.String,
  hardware: LocalHardware,
  auto: OptionalString,
  endpoints: Schema.Array(LocalEndpoint),
  models: Schema.Array(Schema.Struct({ id: Schema.String, live: Schema.Boolean, requests: Schema.Number })),
  controllers: Schema.Array(LocalControllerLink),
  jobs: Schema.Array(LocalJob),
  usage: Schema.Array(LocalUsage),
});
export type LocalSnapshot = typeof LocalSnapshot.Type;

export const LocalRecipe = Schema.Struct({
  id: Schema.String,
  model: Schema.String,
  card: Schema.String,
  engine: Schema.String,
  cards: Schema.Number,
  ctx: Schema.Number,
  tps: Schema.NullOr(Schema.Number),
  fits: Schema.Boolean,
  blocked: OptionalString,
});
export type LocalRecipe = typeof LocalRecipe.Type;

export const LocalRecipes = Schema.Struct({ recipes: Schema.Array(LocalRecipe) });
export type LocalRecipes = typeof LocalRecipes.Type;

export const LocalRunRequest = Schema.Struct({
  gpus: Schema.optionalKey(Schema.Array(Schema.Number)),
  dryRun: Schema.optionalKey(Schema.Boolean),
  replace: Schema.optionalKey(Schema.Boolean),
});
export type LocalRunRequest = typeof LocalRunRequest.Type;

export const LocalPeerRequest = Schema.Struct({ url: Schema.String, remove: Schema.optionalKey(Schema.Boolean) });
export const LocalNameRequest = Schema.Struct({ name: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(64)) });

export const LocalTailnet = Schema.Struct({
  available: Schema.Boolean,
  devices: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      ip: Schema.String,
      controller: Schema.NullOr(Schema.Struct({ id: Schema.String, name: Schema.String, url: Schema.String })),
      linked: Schema.Boolean,
    }),
  ),
});
export type LocalTailnet = typeof LocalTailnet.Type;

export const LocalNode = Schema.Struct({
  controller: LocalControllerInfo,
  endpoints: Schema.Array(LocalEndpoint),
  usage: Schema.Array(LocalUsage),
  peers: Schema.Array(Schema.String),
});
export type LocalNode = typeof LocalNode.Type;
