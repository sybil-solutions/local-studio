import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect, Schema } from "effect";
import { HttpStatus } from "../../core/errors";
import { effectHandler } from "../../http/effect-handler";
import { defineRoutes, documentRoute } from "../../http/route-registrar";
import type { AppContext } from "../../app-context";

const VariantSchema = Schema.Struct({
  format: Schema.Literals(["bf16", "fp8", "nvfp4", "q4"]),
  repo: Schema.String,
  official: Schema.Boolean,
  source: Schema.optional(Schema.String),
  allow_patterns: Schema.optional(Schema.Array(Schema.String)),
  size_gb: Schema.NullOr(Schema.Number),
  caveat: Schema.NullOr(Schema.String),
});

const ModelSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  role: Schema.NullOr(Schema.Literals(["fast", "smart"])),
  description: Schema.String,
  params: Schema.String,
  active_params_b: Schema.NullOr(Schema.Number),
  context_tokens: Schema.Number,
  license: Schema.String,
  multimodal: Schema.Boolean,
  notes: Schema.Array(Schema.String),
  variants: Schema.Array(VariantSchema),
});

const TierSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  blurb: Schema.String,
  models: Schema.Array(ModelSchema),
});

export const ModelIndexSchema = Schema.Struct({
  version: Schema.Number,
  updated: Schema.String,
  tiers: Schema.Array(TierSchema),
});

export type ModelIndex = Schema.Schema.Type<typeof ModelIndexSchema>;

class ModelIndexError extends Schema.TaggedErrorClass<ModelIndexError>()("ModelIndexError", {
  message: Schema.String,
  source: Schema.optional(Schema.Unknown),
}) {}

const BUNDLED_INDEX_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "model-index.json");

interface ModelIndexCacheEntry {
  path: string;
  mtimeMs: number;
  index: ModelIndex;
}

let cache: ModelIndexCacheEntry | null = null;

const resolveIndexPath = (dataDirectory: string): string => {
  const overridePath = resolve(dataDirectory, "model-index.json");
  return existsSync(overridePath) ? overridePath : BUNDLED_INDEX_PATH;
};

const readAndValidate = (path: string): Effect.Effect<ModelIndex, ModelIndexError> =>
  Effect.tryPromise({
    try: () => readFile(path, "utf8"),
    catch: (source) =>
      new ModelIndexError({ message: `Could not read model index at ${path}`, source }),
  }).pipe(
    Effect.flatMap((raw) =>
      Effect.try({
        try: () => JSON.parse(raw) as unknown,
        catch: (source) =>
          new ModelIndexError({ message: `Model index at ${path} is not valid JSON`, source }),
      }),
    ),
    Effect.flatMap((value) =>
      Schema.decodeUnknownEffect(ModelIndexSchema)(value).pipe(
        Effect.mapError(
          (source) =>
            new ModelIndexError({ message: `Model index at ${path} failed validation`, source }),
        ),
      ),
    ),
  );

export const loadModelIndex = (
  context: Pick<AppContext, "config" | "logger">,
): Effect.Effect<ModelIndex, ModelIndexError> =>
  Effect.gen(function* () {
    const path = resolveIndexPath(context.config.data_dir);
    const fileStat = yield* Effect.tryPromise({
      try: () => stat(path),
      catch: (source) =>
        new ModelIndexError({ message: `Model index file not found at ${path}`, source }),
    });
    if (cache && cache.path === path && cache.mtimeMs === fileStat.mtimeMs) {
      return cache.index;
    }
    const index = yield* readAndValidate(path);
    cache = { path, mtimeMs: fileStat.mtimeMs, index };
    context.logger.info(`Serving model index from ${path}`);
    return index;
  });

export const registerStudioModelIndexRoutes = defineRoutes((app, context) =>
  app.get(
    "/studio/model-index",
    documentRoute,
    effectHandler((ctx) =>
      loadModelIndex(context).pipe(
        Effect.map((index) => ctx.json(index)),
        Effect.mapError(
          (error) => new HttpStatus({ status: 500, detail: error.message }),
        ),
      ),
    ),
  ),
);
