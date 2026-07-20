import { Effect, Schema } from "effect";
import type { DownloadFileInfo } from "../types";
import { EngineOperationError } from "../engine-spec";

const escapeRegex = (value: string): string => value.replace(/[.+^${}()|[\]\\]/g, "\\$&");

const compileGlob = (pattern: string): RegExp => {
  const escaped = escapeRegex(pattern);
  const regex = "^" + escaped.replace(/\*/g, ".*") + "$";
  return new RegExp(regex, "i");
};

const matchesAny = (value: string, patterns: string[]): boolean => {
  if (patterns.length === 0) {
    return false;
  }
  return patterns.some((pattern) => compileGlob(pattern).test(value));
};

export type FetchEffect = (
  url: string,
  init?: RequestInit,
) => Effect.Effect<Response, EngineOperationError>;

const operationError = (operation: string, cause: unknown): EngineOperationError =>
  new EngineOperationError({
    operation,
    message: cause instanceof Error ? cause.message : String(cause),
  });

export const fetchEffect: FetchEffect = (url, init) =>
  Effect.tryPromise({
    try: (signal) =>
      fetch(url, {
        ...init,
        signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal,
      }),
    catch: (cause) => operationError("fetch-hugging-face", cause),
  });

const HuggingFaceModelInfoSchema = Schema.Struct({
  modelId: Schema.optional(Schema.String),
  sha: Schema.optional(Schema.String),
  siblings: Schema.optional(
    Schema.Array(
      Schema.Struct({
        rfilename: Schema.String,
        size: Schema.optional(Schema.NullOr(Schema.Number)),
      }),
    ),
  ),
});

export type HuggingFaceModelInfo = Schema.Schema.Type<typeof HuggingFaceModelInfoSchema>;

export const fetchHuggingFaceModelInfo = (
  modelId: string,
  revision?: string | null,
  hfToken?: string | null,
  fetchImpl: FetchEffect = fetchEffect,
): Effect.Effect<HuggingFaceModelInfo, EngineOperationError> =>
  Effect.gen(function* () {
    const encodedModelId = modelId.split("/").map(encodeURIComponent).join("/");
    const url = new URL(`https://huggingface.co/api/models/${encodedModelId}`);
    url.searchParams.set("blobs", "true");
    if (revision) url.searchParams.set("revision", revision);
    const headers: Record<string, string> = {};
    if (hfToken) headers["Authorization"] = `Bearer ${hfToken}`;
    const response = yield* fetchImpl(url.toString(), { headers });
    if (!response.ok) {
      const body = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: (cause) => operationError("read-hugging-face-error", cause),
      });
      return yield* Effect.fail(
        operationError(
          "fetch-hugging-face-model-info",
          `Hugging Face API error: ${response.status} ${body}`,
        ),
      );
    }
    const body = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: (cause) => operationError("decode-hugging-face-model-info", cause),
    });
    return yield* Schema.decodeUnknownEffect(HuggingFaceModelInfoSchema)(body).pipe(
      Effect.mapError((cause) => operationError("decode-hugging-face-model-info", cause)),
    );
  });

export const buildHuggingFaceFileList = (
  modelInfo: HuggingFaceModelInfo,
  allowPatterns: string[],
  ignorePatterns: string[],
): DownloadFileInfo[] => {
  const siblings = modelInfo.siblings ?? [];
  if (allowPatterns.length === 0) {
    const primaryGgufFiles = siblings
      .map((sibling) => sibling.rfilename)
      .filter(
        (filename) =>
          /\.gguf$/i.test(filename) &&
          !/(?:^|[-_.])(mmproj|projector|adapter|draft)(?:[-_.]|$)/i.test(filename),
      );
    const ggufFamilies = new Set(
      primaryGgufFiles.map((filename) =>
        filename.replace(/-\d{5}-of-\d{5}\.gguf$/i, ".gguf"),
      ),
    );
    if (ggufFamilies.size > 1) {
      throw new Error(
        `Multiple GGUF weight variants found. Choose one file before downloading: ${[
          ...ggufFamilies,
        ]
          .slice(0, 8)
          .join(", ")}`,
      );
    }
  }
  const files: DownloadFileInfo[] = [];
  for (const sibling of siblings) {
    const filename = sibling.rfilename;
    if (!filename) {
      continue;
    }
    if (matchesAny(filename, ignorePatterns)) {
      continue;
    }
    if (allowPatterns.length > 0 && !matchesAny(filename, allowPatterns)) {
      continue;
    }
    files.push({
      path: filename,
      size_bytes: typeof sibling.size === "number" ? sibling.size : null,
      downloaded_bytes: 0,
      status: "pending",
    });
  }
  return files;
};
