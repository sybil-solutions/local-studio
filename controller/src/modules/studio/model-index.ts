import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { Effect, Schema } from "effect";
import {
  ModelIndexSchema,
  bundledModelIndexSource,
  type ModelIndexResponse,
} from "../../../contracts/model-index";
import { HttpStatus } from "../../core/errors";
import { defineRoutes, effectRoute } from "../../http/route-registrar";
import type { AppContext } from "../../app-context";

class ModelIndexError extends Schema.TaggedErrorClass<ModelIndexError>()("ModelIndexError", {
  message: Schema.String,
  source: Schema.optional(Schema.Unknown),
}) {}

interface ModelIndexCacheEntry {
  path: string;
  mtimeMs: number;
  index: ModelIndexResponse;
}

let cache: ModelIndexCacheEntry | null = null;

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

const decodeBundled = (): Effect.Effect<ModelIndexResponse, ModelIndexError> =>
  Schema.decodeUnknownEffect(ModelIndexSchema)(bundledModelIndexSource).pipe(
    Effect.mapError(
      (source) => new ModelIndexError({ message: "Bundled model index failed validation", source }),
    ),
  );

export const loadModelIndex = (
  context: Pick<AppContext, "config" | "logger">,
): Effect.Effect<ModelIndexResponse, ModelIndexError> =>
  Effect.gen(function* () {
    const overridePath = resolve(context.config.data_dir, "model-index.json");
    if (!existsSync(overridePath)) {
      context.logger.info("Serving bundled model index");
      return yield* decodeBundled();
    }
    const fileStat = yield* Effect.tryPromise({
      try: () => stat(overridePath),
      catch: (source) =>
        new ModelIndexError({ message: `Model index file not found at ${overridePath}`, source }),
    });
    if (cache && cache.path === overridePath && cache.mtimeMs === fileStat.mtimeMs) {
      return cache.index;
    }
    const overlay = yield* readAndValidate(overridePath);
    // Merge, not replace: the overlay is also the recipe store, so it exists
    // on every installation that has ever saved a recipe. An overlay with no
    // curated tiers still gets the bundled catalog; hand-authored tiers win.
    const index =
      overlay.tiers.length > 0
        ? overlay
        : yield* decodeBundled().pipe(
            Effect.map((bundled) => ({
              ...overlay,
              tiers: bundled.tiers,
              intelligence_source: overlay.intelligence_source ?? bundled.intelligence_source,
            })),
          );
    cache = { path: overridePath, mtimeMs: fileStat.mtimeMs, index };
    context.logger.info(`Serving model index from ${overridePath}`);
    return index;
  });

export const registerStudioModelIndexRoutes = defineRoutes((app, context) =>
  effectRoute(app.get, "/studio/model-index", (ctx) =>
    loadModelIndex(context).pipe(
      Effect.map((index) => ctx.json(index)),
      Effect.mapError((error) => new HttpStatus({ status: 500, detail: error.message })),
    ),
  ),
);
