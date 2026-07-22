import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect, Schema } from "effect";
import { ModelIndexSchema, type ModelIndexResponse } from "../../../contracts/model-index";
import { HttpStatus } from "../../core/errors";
import { effectHandler } from "../../http/effect-handler";
import { defineRoutes, documentRoute } from "../../http/route-registrar";
import type { AppContext } from "../../app-context";

class ModelIndexError extends Schema.TaggedErrorClass<ModelIndexError>()("ModelIndexError", {
  message: Schema.String,
  source: Schema.optional(Schema.Unknown),
}) {}

const BUNDLED_INDEX_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "model-index.json");

interface ModelIndexCacheEntry {
  path: string;
  mtimeMs: number;
  index: ModelIndexResponse;
}

let cache: ModelIndexCacheEntry | null = null;

const resolveIndexPath = (dataDirectory: string): string => {
  const overridePath = resolve(dataDirectory, "model-index.json");
  return existsSync(overridePath) ? overridePath : BUNDLED_INDEX_PATH;
};

const readAndValidate = (path: string): Effect.Effect<ModelIndexResponse, ModelIndexError> =>
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
): Effect.Effect<ModelIndexResponse, ModelIndexError> =>
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
        Effect.mapError((error) => new HttpStatus({ status: 500, detail: error.message })),
      ),
    ),
  ),
);
