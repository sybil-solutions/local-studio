import {
  accessSync,
  constants,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, resolve, sep } from "node:path";
import { Effect, Fiber, Schema } from "effect";
import { CONTROLLER_EVENTS } from "@local-studio/contracts/controller-events";
import type { Config } from "../../../config/env";
import type { Logger } from "../../../core/logger";
import { Event, type EventManager } from "../../system/event-manager";
import { DOWNLOAD_DEFAULT_IGNORE_FILENAMES, DOWNLOAD_PROGRESS_THROTTLE_MS } from "../configs";
import { EngineOperationError } from "../engine-spec";
import type { DownloadFileInfo, DownloadStatus, ModelDownload } from "../types";
import type { DownloadStore } from "./download-store";
import {
  buildHuggingFaceFileList,
  fetchEffect,
  fetchHuggingFaceModelInfo,
  type FetchEffect,
} from "./huggingface-api";
import { trackWriterFailure, waitForWriterDrain } from "./stream-backpressure";

const sumDownloadedBytes = (files: DownloadFileInfo[]): number =>
  files.reduce((total, file) => total + (file.downloaded_bytes || 0), 0);

const sumTotalBytes = (files: DownloadFileInfo[]): number | null => {
  const known = files.filter((file) => typeof file.size_bytes === "number") as Array<
    DownloadFileInfo & { size_bytes: number }
  >;
  return known.length === 0 ? null : known.reduce((total, file) => total + file.size_bytes, 0);
};

const sameFileSet = (first: DownloadFileInfo[], second: DownloadFileInfo[]): boolean => {
  const firstPaths = first.map((file) => file.path).sort();
  const secondPaths = second.map((file) => file.path).sort();
  return (
    firstPaths.length === secondPaths.length &&
    firstPaths.every((path, index) => path === secondPaths[index])
  );
};

export const findReusableDownload = (
  downloads: ModelDownload[],
  modelId: string,
  targetDirectory: string,
  files: DownloadFileInfo[],
): ModelDownload | null => {
  const matching = downloads.filter(
    (download) =>
      download.model_id === modelId &&
      download.target_dir === targetDirectory &&
      sameFileSet(download.files, files),
  );
  return (
    matching.find((download) => download.status === "completed") ??
    matching.find(
      (download) => download.status === "downloading" || download.status === "queued",
    ) ??
    matching.find((download) => download.status === "paused") ??
    null
  );
};

const sanitizePathSegments = (value: string): string[] =>
  value
    .split(/[\\/]/)
    .map((segment) => segment.trim())
    .filter((segment) => Boolean(segment) && segment !== "." && segment !== "..");

const resolveDownloadRoot = (
  config: Config,
  modelId: string,
  destination?: string | null,
): string => {
  const base = resolve(config.models_dir);
  const segments = destination ? sanitizePathSegments(destination) : sanitizePathSegments(modelId);
  const target = resolve(base, ...segments);
  const normalizedBase = base.endsWith(sep) ? base : base + sep;
  if (!target.startsWith(normalizedBase)) throw new Error("Invalid destination path");
  return target;
};

export const DownloadRequestSchema = Schema.Struct({
  model_id: Schema.String.check(Schema.isNonEmpty()),
  revision: Schema.optional(Schema.NullOr(Schema.String)),
  destination_dir: Schema.optional(Schema.NullOr(Schema.String)),
  allow_patterns: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
  ignore_patterns: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
  hf_token: Schema.optional(Schema.NullOr(Schema.String)),
});

export const DownloadTokenSchema = Schema.Struct({
  hf_token: Schema.optional(Schema.NullOr(Schema.String)),
});

export type DownloadRequest = Schema.Schema.Type<typeof DownloadRequestSchema>;

type ActiveDownload = {
  controller: AbortController;
  fiber: Fiber.Fiber<void, never> | null;
};

const toTimestamp = (): string => new Date().toISOString();

const operationError = (operation: string, cause: unknown): EngineOperationError =>
  new EngineOperationError({
    operation,
    message: cause instanceof Error ? cause.message : String(cause),
  });

const attempt = <A>(operation: string, evaluate: () => A): Effect.Effect<A, EngineOperationError> =>
  Effect.try({
    try: evaluate,
    catch: (cause) => operationError(operation, cause),
  });

const closeWriter = (
  writer: ReturnType<typeof createWriteStream>,
): Effect.Effect<void, EngineOperationError> =>
  writer.closed || writer.destroyed
    ? Effect.void
    : Effect.callback<void, EngineOperationError>((resume) => {
        let completed = false;
        const cleanup = (): void => {
          writer.removeListener("error", onError);
          writer.removeListener("close", onClose);
        };
        const finish = (effect: Effect.Effect<void, EngineOperationError>): void => {
          if (completed) return;
          completed = true;
          cleanup();
          resume(effect);
        };
        const onError = (cause: unknown): void =>
          finish(Effect.fail(operationError("close-download-writer", cause)));
        const onClose = (): void => finish(Effect.void);
        writer.once("error", onError);
        writer.once("close", onClose);
        try {
          writer.end();
        } catch (cause) {
          onError(cause);
        }
        return Effect.sync(cleanup);
      });

export class DownloadManager {
  private readonly active = new Map<string, ActiveDownload>();

  private constructor(
    private readonly config: Config,
    private readonly store: DownloadStore,
    private readonly eventManager: EventManager,
    private readonly logger: Logger,
    private readonly fetchImpl: FetchEffect = fetchEffect,
  ) {}

  public static make(
    config: Config,
    store: DownloadStore,
    eventManager: EventManager,
    logger: Logger,
    fetchImpl: FetchEffect = fetchEffect,
  ): Effect.Effect<DownloadManager, EngineOperationError> {
    return Effect.gen(function* () {
      const manager = new DownloadManager(config, store, eventManager, logger, fetchImpl);
      yield* manager.rehydrate();
      return manager;
    });
  }

  private rehydrate(): Effect.Effect<void, EngineOperationError> {
    const store = this.store;
    return Effect.gen(function* () {
      const downloads = yield* store.list();
      yield* Effect.forEach(
        downloads,
        (download) =>
          download.status === "downloading" || download.status === "queued"
            ? store.save({ ...download, status: "paused", error: "Restart required" })
            : Effect.void,
        { discard: true },
      );
    });
  }

  public list(): Effect.Effect<ModelDownload[], EngineOperationError> {
    return this.store.list();
  }

  public get(id: string): Effect.Effect<ModelDownload | null, EngineOperationError> {
    return this.store.get(id);
  }

  public start(request: DownloadRequest): Effect.Effect<ModelDownload, EngineOperationError> {
    const manager = this;
    return Effect.gen(function* () {
      const modelId = request.model_id?.trim();
      if (!modelId)
        return yield* Effect.fail(operationError("start-download", "Model id is required"));
      const allowPatterns = (request.allow_patterns ?? []).filter(Boolean);
      const ignorePatterns = [
        ...DOWNLOAD_DEFAULT_IGNORE_FILENAMES,
        ...(request.ignore_patterns ?? []).filter(Boolean),
      ];
      const targetDirectory = yield* attempt("resolve-download-root", () =>
        resolveDownloadRoot(manager.config, modelId, request.destination_dir),
      );
      yield* manager.ensureModelsDirectoryWritable();
      const hfToken = request.hf_token ?? null;
      const info = yield* fetchHuggingFaceModelInfo(
        modelId,
        request.revision,
        hfToken,
        manager.fetchImpl,
      );
      const files = yield* attempt("select-download-files", () =>
        buildHuggingFaceFileList(info, allowPatterns, ignorePatterns),
      );
      if (files.length === 0) {
        return yield* Effect.fail(
          operationError("start-download", "No downloadable files found for this model"),
        );
      }
      const existing = findReusableDownload(
        yield* manager.store.list(),
        modelId,
        targetDirectory,
        files,
      );
      if (existing) return existing;
      const now = toTimestamp();
      const download: ModelDownload = {
        id: randomUUID(),
        model_id: modelId,
        revision: info.sha ?? request.revision ?? null,
        status: "queued",
        created_at: now,
        updated_at: now,
        target_dir: targetDirectory,
        total_bytes: sumTotalBytes(files),
        downloaded_bytes: 0,
        files,
        error: null,
      };
      yield* manager.store.save(download);
      yield* manager.launchRun(download.id, hfToken);
      return download;
    });
  }

  private ensureModelsDirectoryWritable(): Effect.Effect<void, EngineOperationError> {
    return attempt("prepare-models-directory", () => {
      mkdirSync(this.config.models_dir, { recursive: true });
      accessSync(this.config.models_dir, constants.W_OK);
    }).pipe(
      Effect.mapError(
        (error) =>
          new EngineOperationError({
            operation: error.operation,
            message:
              `Models directory is not writable by the controller: ${this.config.models_dir}. ` +
              `Update Settings → Models directory to a writable server path. ${error.message}`,
          }),
      ),
    );
  }

  public pause(id: string): Effect.Effect<ModelDownload, EngineOperationError> {
    const manager = this;
    return Effect.gen(function* () {
      const download = yield* manager.requireDownload(id);
      download.status = "paused";
      download.updated_at = toTimestamp();
      yield* manager.store.save(download);
      yield* manager.abortActive(id);
      yield* manager.publishState(download, "paused");
      return download;
    });
  }

  public resume(
    id: string,
    hfToken: string | null = null,
  ): Effect.Effect<ModelDownload, EngineOperationError> {
    const manager = this;
    return Effect.gen(function* () {
      const download = yield* manager.requireDownload(id);
      if (download.status === "completed") return download;
      download.status = "queued";
      download.updated_at = toTimestamp();
      download.error = null;
      yield* manager.store.save(download);
      yield* manager.launchRun(download.id, hfToken);
      yield* manager.publishState(download, "queued");
      return download;
    });
  }

  public cancel(id: string): Effect.Effect<ModelDownload, EngineOperationError> {
    const manager = this;
    return Effect.gen(function* () {
      const download = yield* manager.requireDownload(id);
      download.status = "canceled";
      download.updated_at = toTimestamp();
      yield* manager.store.save(download);
      yield* manager.abortActive(id);
      yield* manager.publishState(download, "canceled");
      return download;
    });
  }

  public shutdown(): Effect.Effect<void> {
    const manager = this;
    return Effect.gen(function* () {
      const active = [...manager.active.values()];
      for (const download of active) download.controller.abort();
      yield* Effect.forEach(
        active,
        (download) =>
          download.fiber ? Fiber.interrupt(download.fiber).pipe(Effect.asVoid) : Effect.void,
        { discard: true },
      );
      manager.active.clear();
    });
  }

  private requireDownload(id: string): Effect.Effect<ModelDownload, EngineOperationError> {
    return this.store
      .get(id)
      .pipe(
        Effect.flatMap((download) =>
          download
            ? Effect.succeed(download)
            : Effect.fail(operationError("get-download", "Download not found")),
        ),
      );
  }

  private launchRun(id: string, hfToken: string | null): Effect.Effect<void> {
    const manager = this;
    return Effect.gen(function* () {
      if (manager.active.has(id)) return;
      const owner: ActiveDownload = { controller: new AbortController(), fiber: null };
      manager.active.set(id, owner);
      owner.fiber = yield* Effect.forkDetach(manager.runDownload(id, hfToken, owner));
    });
  }

  private abortActive(id: string): Effect.Effect<void> {
    const active = this.active.get(id);
    if (!active) return Effect.void;
    active.controller.abort();
    return active.fiber
      ? Fiber.interrupt(active.fiber).pipe(Effect.asVoid)
      : Effect.sync(() => this.active.delete(id)).pipe(Effect.asVoid);
  }

  private runDownload(
    id: string,
    hfToken: string | null,
    owner: ActiveDownload,
  ): Effect.Effect<void, never> {
    const manager = this;
    return Effect.gen(function* () {
      const download = yield* manager.store.get(id);
      if (!download || download.status === "completed" || download.status === "canceled") return;
      const controller = owner.controller;
      const stillOwner = (): boolean => manager.active.get(id) === owner;
      let current = {
        ...download,
        status: "downloading" as DownloadStatus,
        updated_at: toTimestamp(),
      };
      const operation = Effect.gen(function* () {
        yield* manager.store.save(current);
        yield* manager.publishState(current, "downloading");
        yield* attempt("create-download-directory", () =>
          mkdirSync(current.target_dir, { recursive: true }),
        );
        for (const file of current.files) {
          if (controller.signal.aborted) break;
          if (current.status === "paused" || current.status === "canceled") break;
          if (file.status === "completed") continue;
          yield* manager.downloadFile(current, file, controller, hfToken);
          current = (yield* manager.store.get(id)) ?? current;
        }
        if (!stillOwner()) return;
        current = (yield* manager.store.get(id)) ?? current;
        if (current.status === "paused" || current.status === "canceled") return;
        const allComplete = current.files.every((file) => file.status === "completed");
        current.status = allComplete ? "completed" : "failed";
        current.completed_at = allComplete ? toTimestamp() : null;
        current.error = allComplete ? null : (current.error ?? "Download incomplete");
        current.downloaded_bytes = sumDownloadedBytes(current.files);
        current.total_bytes = current.total_bytes ?? sumTotalBytes(current.files);
        current.updated_at = toTimestamp();
        yield* manager.store.save(current);
        yield* manager.publishState(current, current.status);
      }).pipe(
        Effect.catch((error) => {
          if (!stillOwner()) return Effect.void;
          return Effect.gen(function* () {
            const latest = (yield* manager.store.get(id)) ?? current;
            latest.status = controller.signal.aborted
              ? latest.status === "canceled"
                ? "canceled"
                : "paused"
              : "failed";
            latest.error = controller.signal.aborted ? latest.error : error.message;
            latest.downloaded_bytes = sumDownloadedBytes(latest.files);
            latest.updated_at = toTimestamp();
            yield* manager.store.save(latest);
            yield* manager.publishState(latest, latest.status);
            if (!controller.signal.aborted) {
              manager.logger.error("Download failed", { error: error.message, id });
            }
          }).pipe(Effect.catch(() => Effect.void));
        }),
        Effect.ensuring(
          Effect.sync(() => {
            if (stillOwner()) manager.active.delete(id);
          }),
        ),
      );
      yield* operation;
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => manager.logger.error("Download failed", { error: error.message, id })),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          if (manager.active.get(id) === owner) manager.active.delete(id);
        }),
      ),
    );
  }

  private downloadFile(
    download: ModelDownload,
    file: DownloadFileInfo,
    controller: AbortController,
    hfToken: string | null,
  ): Effect.Effect<void, EngineOperationError> {
    const manager = this;
    return Effect.gen(function* () {
      let currentDownload = download;
      const localPath = resolve(download.target_dir, ...sanitizePathSegments(file.path));
      const temporaryPath = `${localPath}.part`;
      yield* attempt("create-download-file-directory", () =>
        mkdirSync(dirname(localPath), { recursive: true }),
      );
      const existingFinal = yield* attempt("inspect-downloaded-file", () =>
        existsSync(localPath) ? statSync(localPath).size : 0,
      );
      if (file.size_bytes && existingFinal >= file.size_bytes) {
        file.status = "completed";
        file.downloaded_bytes = file.size_bytes;
        yield* manager.persistFileUpdate(currentDownload, file);
        return;
      }
      const existing = yield* attempt("inspect-partial-download", () =>
        existsSync(temporaryPath) ? statSync(temporaryPath).size : 0,
      );
      const headers: Record<string, string> = {};
      if (hfToken) headers["Authorization"] = `Bearer ${hfToken}`;
      if (existing > 0) headers["Range"] = `bytes=${existing}-`;
      const url = `https://huggingface.co/${download.model_id}/resolve/${download.revision ?? "main"}/${file.path}`;
      file.status = "downloading";
      file.downloaded_bytes = existing;
      currentDownload = yield* manager.persistFileUpdate(currentDownload, file);
      const response = yield* manager.fetchImpl(url, { headers, signal: controller.signal });
      if (response.status === 416) {
        if (file.size_bytes && existing >= file.size_bytes) {
          yield* attempt("finalize-partial-download", () => renameSync(temporaryPath, localPath));
          file.status = "completed";
          file.downloaded_bytes = file.size_bytes;
          yield* manager.persistFileUpdate(currentDownload, file);
          return;
        }
        return yield* Effect.fail(
          operationError("download-file", `Download range not satisfiable for ${file.path}`),
        );
      }
      if (!response.ok && response.status !== 206 && response.status !== 200) {
        return yield* Effect.fail(
          operationError(
            "download-file",
            `Download failed: ${response.status} ${response.statusText}`,
          ),
        );
      }
      const shouldAppend = existing > 0 && response.status === 206;
      const baseExisting = shouldAppend ? existing : 0;
      const contentLength = Number(response.headers.get("content-length") ?? 0);
      if (!file.size_bytes && contentLength > 0) file.size_bytes = contentLength + baseExisting;
      if (!shouldAppend && existing > 0) {
        file.downloaded_bytes = 0;
        currentDownload = yield* manager.persistFileUpdate(currentDownload, file);
      }
      const writer = yield* attempt("open-download-writer", () =>
        createWriteStream(temporaryPath, { flags: shouldAppend ? "a" : "w" }),
      );
      const writerFailure = trackWriterFailure(writer);
      const reader = response.body?.getReader();
      if (!reader) {
        yield* closeWriter(writer).pipe(Effect.ensuring(Effect.sync(writerFailure.dispose)));
        return yield* Effect.fail(
          operationError("read-download-stream", "Download response has no body"),
        );
      }
      let downloaded = baseExisting;
      let lastUpdate = Date.now();
      const consume = Effect.acquireUseRelease(
        Effect.succeed(reader),
        (streamReader) =>
          Effect.gen(function* () {
            while (true) {
              yield* attempt("check-download-writer", writerFailure.throwIfFailed);
              const chunk = yield* Effect.tryPromise({
                try: () => streamReader.read(),
                catch: (cause) => operationError("read-download-stream", cause),
              });
              yield* attempt("check-download-writer", writerFailure.throwIfFailed);
              if (chunk.done) break;
              if (!chunk.value) continue;
              const writable = yield* attempt("write-download-stream", () =>
                writer.write(Buffer.from(chunk.value)),
              );
              yield* attempt("check-download-writer", writerFailure.throwIfFailed);
              if (!writable) {
                yield* waitForWriterDrain(writer).pipe(
                  Effect.mapError((cause) => operationError("drain-download-writer", cause)),
                );
                yield* attempt("check-download-writer", writerFailure.throwIfFailed);
              }
              downloaded += chunk.value.length;
              file.downloaded_bytes = downloaded;
              if (Date.now() - lastUpdate <= DOWNLOAD_PROGRESS_THROTTLE_MS) continue;
              currentDownload = yield* manager.persistFileUpdate(currentDownload, file);
              yield* manager.publishProgress(currentDownload, file);
              lastUpdate = Date.now();
            }
          }),
        (streamReader) =>
          Effect.tryPromise({
            try: () => streamReader.cancel(),
            catch: () => undefined,
          }).pipe(
            Effect.catch(() => Effect.void),
            Effect.ensuring(
              Effect.sync(() => {
                try {
                  streamReader.releaseLock();
                } catch {
                  return;
                }
              }),
            ),
          ),
      );
      yield* consume.pipe(
        Effect.onExit(() =>
          closeWriter(writer).pipe(Effect.ensuring(Effect.sync(writerFailure.dispose))),
        ),
      );
      file.downloaded_bytes = downloaded;
      if (file.size_bytes && downloaded < file.size_bytes) {
        file.status = "error";
        yield* manager.persistFileUpdate(currentDownload, file);
        return yield* Effect.fail(
          operationError("download-file", `Incomplete download for ${file.path}`),
        );
      }
      yield* attempt("finalize-download-file", () => renameSync(temporaryPath, localPath));
      file.status = "completed";
      currentDownload = yield* manager.persistFileUpdate(currentDownload, file);
      yield* manager.publishProgress(currentDownload, file);
    });
  }

  private persistFileUpdate(
    download: ModelDownload,
    file: DownloadFileInfo,
  ): Effect.Effect<ModelDownload, EngineOperationError> {
    const store = this.store;
    return Effect.gen(function* () {
      const latest = (yield* store.get(download.id)) ?? download;
      const updatedFiles = latest.files.map((entry) =>
        entry.path === file.path ? { ...file } : entry,
      );
      const updated: ModelDownload = {
        ...latest,
        files: updatedFiles,
        downloaded_bytes: sumDownloadedBytes(updatedFiles),
        total_bytes: latest.total_bytes ?? sumTotalBytes(updatedFiles),
        updated_at: toTimestamp(),
      };
      yield* store.save(updated);
      return updated;
    });
  }

  private publishProgress(
    download: ModelDownload,
    file: DownloadFileInfo,
  ): Effect.Effect<void, never> {
    const payload = {
      id: download.id,
      model_id: download.model_id,
      status: download.status,
      downloaded_bytes: download.downloaded_bytes,
      total_bytes: download.total_bytes,
      file: {
        path: file.path,
        downloaded_bytes: file.downloaded_bytes,
        size_bytes: file.size_bytes,
        status: file.status,
      },
    };
    return this.publishEvent(new Event(CONTROLLER_EVENTS.DOWNLOAD_PROGRESS, payload));
  }

  private publishState(
    download: ModelDownload,
    status: DownloadStatus,
  ): Effect.Effect<void, never> {
    return this.publishEvent(
      new Event(CONTROLLER_EVENTS.DOWNLOAD_STATE, {
        id: download.id,
        model_id: download.model_id,
        status,
        downloaded_bytes: download.downloaded_bytes,
        total_bytes: download.total_bytes,
        error: download.error,
      }),
    );
  }

  private publishEvent(event: Event): Effect.Effect<void, never> {
    return this.eventManager.publish(event);
  }
}
