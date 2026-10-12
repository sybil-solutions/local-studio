import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import type { ModelInfo } from "./types";

const MODEL_BROWSER_WEIGHT_EXTENSIONS = [".safetensors", ".bin", ".gguf"] as const;
const MODEL_BROWSER_CONFIG_FILENAMES = ["config.json"] as const;
const MODEL_QUANTIZATION_SIGNATURES = [
  "awq",
  "gptq",
  "gguf",
  "fp16",
  "bf16",
  "int8",
  "int4",
  "w4a16",
  "w8a16",
];

export class ModelBrowserError extends Schema.TaggedErrorClass<ModelBrowserError>()(
  "ModelBrowserError",
  {
    operation: Schema.Literals(["read", "stat", "scan"]),
    path: Schema.String,
    message: Schema.String,
    source: Schema.Unknown,
  },
) {}

const modelBrowserError = (
  operation: ModelBrowserError["operation"],
  path: string,
  source: unknown,
): ModelBrowserError =>
  new ModelBrowserError({
    operation,
    path,
    message: `Model ${operation} failed for ${path}: ${String(source)}`,
    source,
  });

const isWeightFile = (name: string): boolean =>
  MODEL_BROWSER_WEIGHT_EXTENSIONS.some((extension) => name.toLowerCase().endsWith(extension));

export const looksLikeModelDirectory = (path: string): Effect.Effect<boolean, ModelBrowserError> =>
  Effect.tryPromise({
    try: () => readdir(path, { withFileTypes: true }),
    catch: (source) => modelBrowserError("scan", path, source),
  }).pipe(
    Effect.map(
      (entries) =>
        MODEL_BROWSER_CONFIG_FILENAMES.some((configName) =>
          entries.some((entry) => entry.isFile() && entry.name === configName),
        ) || entries.some((entry) => entry.isFile() && isWeightFile(entry.name)),
    ),
  );

export const inferQuantization = (name: string): string | undefined => {
  const lower = name.toLowerCase();
  return MODEL_QUANTIZATION_SIGNATURES.find((value) => lower.includes(value));
};

export const readConfigMetadata = (
  modelDirectory: string,
): Effect.Effect<
  { architecture: string | null; context_length: number | null },
  ModelBrowserError
> => {
  const configPath = join(modelDirectory, "config.json");
  return Effect.tryPromise({
    try: () => readFile(configPath, "utf-8"),
    catch: (source) => modelBrowserError("read", configPath, source),
  }).pipe(
    Effect.flatMap((content) =>
      Effect.try({
        try: () => JSON.parse(content) as Record<string, unknown>,
        catch: (source) => modelBrowserError("read", configPath, source),
      }),
    ),
    Effect.map((parsed) => {
      const architectures = parsed["architectures"];
      const architecture =
        Array.isArray(architectures) && architectures.length > 0 ? String(architectures[0]) : null;
      const raw =
        parsed["max_position_embeddings"] ??
        parsed["max_seq_len"] ??
        parsed["seq_length"] ??
        parsed["n_ctx"];
      const contextLength =
        typeof raw === "number"
          ? raw
          : typeof raw === "string" && /^\d+$/.test(raw)
            ? Number(raw)
            : null;
      return { architecture, context_length: contextLength };
    }),
  );
};

export const estimateWeightsSizeBytes = (
  modelDirectory: string,
  recursive: boolean,
): Effect.Effect<number | null, ModelBrowserError> =>
  Effect.gen(function* () {
    const rootStats = yield* Effect.tryPromise({
      try: () => stat(modelDirectory),
      catch: (source) => modelBrowserError("stat", modelDirectory, source),
    });
    if (rootStats.isFile()) {
      return isWeightFile(modelDirectory) && rootStats.size > 0 ? rootStats.size : null;
    }
    const entries = yield* Effect.tryPromise({
      try: () => readdir(modelDirectory, { withFileTypes: true }),
      catch: (source) => modelBrowserError("scan", modelDirectory, source),
    });
    let total = 0;
    for (const entry of entries) {
      const path = join(modelDirectory, entry.name);
      if (entry.isDirectory() && recursive) {
        total +=
          (yield* estimateWeightsSizeBytes(path, true).pipe(
            Effect.catch(() => Effect.succeed(null)),
          )) ?? 0;
      } else if (entry.isFile() && isWeightFile(entry.name)) {
        total += yield* Effect.tryPromise({
          try: async () => (await stat(path)).size,
          catch: (source) => modelBrowserError("stat", path, source),
        }).pipe(Effect.catch(() => Effect.succeed(0)));
      }
    }
    return total || null;
  });

export const discoverModelDirectories = (
  roots: string[],
  maxDepth = 1,
  maxModels = 500,
): Effect.Effect<string[], never> =>
  Effect.gen(function* () {
    const discovered: string[] = [];
    const seen = new Set<string>();
    const queue = roots.filter(Boolean).map((path) => ({ path, depth: 0 }));
    while (queue.length > 0 && discovered.length < maxModels) {
      const entry = queue.shift();
      if (!entry || seen.has(entry.path)) continue;
      seen.add(entry.path);
      const modelDirectory = yield* looksLikeModelDirectory(entry.path).pipe(
        Effect.catch(() => Effect.succeed(false)),
      );
      if (modelDirectory) {
        discovered.push(entry.path);
        continue;
      }
      if (entry.depth >= maxDepth) continue;
      const children = yield* Effect.tryPromise({
        try: () => readdir(entry.path, { withFileTypes: true }),
        catch: () => null,
      }).pipe(Effect.catch(() => Effect.succeed(null)));
      if (!children) continue;
      for (const child of children) {
        if (child.isDirectory() && !child.name.startsWith(".")) {
          queue.push({ path: join(entry.path, child.name), depth: entry.depth + 1 });
        }
      }
    }
    return discovered;
  });

export const buildModelInfo = (
  modelDirectory: string,
  recipeIds: string[] = [],
): Effect.Effect<ModelInfo, never> =>
  Effect.gen(function* () {
    const metadata = yield* readConfigMetadata(modelDirectory).pipe(
      Effect.catch(() => Effect.succeed({ architecture: null, context_length: null })),
    );
    const modifiedAt = yield* Effect.tryPromise({
      try: async () => (await stat(modelDirectory)).mtimeMs,
      catch: () => null,
    }).pipe(Effect.catch(() => Effect.succeed(null)));
    const name = modelDirectory.split("/").pop() ?? modelDirectory;
    const size = yield* estimateWeightsSizeBytes(modelDirectory, false).pipe(
      Effect.catch(() => Effect.succeed(null)),
    );
    return {
      name,
      path: modelDirectory,
      size_bytes: size,
      modified_at: modifiedAt,
      architecture: metadata.architecture,
      quantization: inferQuantization(name) ?? null,
      context_length: metadata.context_length,
      recipe_ids: [...new Set(recipeIds)].sort(),
      has_recipe: recipeIds.length > 0,
    };
  });
