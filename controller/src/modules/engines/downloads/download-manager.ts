import {
  accessSync,
  constants,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
} from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import type { Config } from "../../../config/env";
import type { Logger } from "../../../core/logger";
import { Event, type EventManager } from "../../system/event-manager";
import { CONTROLLER_EVENTS } from "@local-studio/contracts/controller-events";
import type { DownloadFileInfo, DownloadStatus, ModelDownload } from "../types";
import type { DownloadStore } from "./download-store";
import {
  buildHuggingFaceFileList,
  fetchHuggingFaceModelInfo,
  type FetchLike,
} from "./huggingface-api";
import { trackWriterFailure, waitForWriterDrain } from "./stream-backpressure";
import { DOWNLOAD_DEFAULT_IGNORE_FILENAMES, DOWNLOAD_PROGRESS_THROTTLE_MS } from "../configs";

const sumDownloadedBytes = (files: DownloadFileInfo[]): number => {
  return files.reduce((total, file) => total + (file.downloaded_bytes || 0), 0);
};

const sumTotalBytes = (files: DownloadFileInfo[]): number | null => {
  const known = files.filter((file) => typeof file.size_bytes === "number") as Array<
    DownloadFileInfo & { size_bytes: number }
  >;
  if (known.length === 0) {
    return null;
  }
  return known.reduce((total, file) => total + file.size_bytes, 0);
};

const sanitizePathSegments = (value: string): string[] => {
  return value
    .split(/[\\/]/)
    .map((segment) => segment.trim())
    .filter((segment) => Boolean(segment) && segment !== "." && segment !== "..");
};

const resolveDownloadRoot = (
  config: Config,
  modelId: string,
  destination?: string | null,
): string => {
  const base = resolve(config.models_dir);
  const segments = destination ? sanitizePathSegments(destination) : sanitizePathSegments(modelId);
  const target = resolve(base, ...segments);
  const normalizedBase = base.endsWith(sep) ? base : base + sep;
  if (!target.startsWith(normalizedBase)) {
    throw new Error("Invalid destination path");
  }
  return target;
};

type DownloadRequest = {
  model_id: string;
  revision?: string | null;
  destination_dir?: string | null;
  allow_patterns?: string[] | null;
  ignore_patterns?: string[] | null;
  hf_token?: string | null;
};

type ActiveDownload = {
  controller: AbortController;
  running: boolean;
};

const toTimestamp = (): string => new Date().toISOString();

/** Manages model downloads (queue/pause/resume/cancel), persisting state and emitting progress events. */
export class DownloadManager {
  private readonly active = new Map<string, ActiveDownload>();

  public constructor(
    private readonly config: Config,
    private readonly store: DownloadStore,
    private readonly eventManager: EventManager,
    private readonly logger: Logger,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    this.rehydrate();
  }

  /** Marks in-flight downloads as paused after a process restart. */
  private rehydrate(): void {
    const downloads = this.store.list();
    for (const download of downloads) {
      if (download.status === "downloading" || download.status === "queued") {
        const updated = {
          ...download,
          status: "paused" as DownloadStatus,
          error: "Restart required",
        };
        this.store.save(updated);
      }
    }
  }

  public list(): ModelDownload[] {
    return this.store.list();
  }

  public get(id: string): ModelDownload | null {
    return this.store.get(id);
  }

  public async start(request: DownloadRequest): Promise<ModelDownload> {
    const modelId = request.model_id?.trim();
    if (!modelId) {
      throw new Error("Model id is required");
    }
    const allowPatterns = (request.allow_patterns ?? []).filter(Boolean);
    const ignorePatterns = [
      ...DOWNLOAD_DEFAULT_IGNORE_FILENAMES,
      ...(request.ignore_patterns ?? []).filter(Boolean),
    ];
    const targetDirectory = resolveDownloadRoot(this.config, modelId, request.destination_dir);
    this.ensureModelsDirectoryWritable();
    const hfToken = request.hf_token ?? null;

    const info = await fetchHuggingFaceModelInfo(modelId, request.revision, hfToken, this.fetchImpl);
    const files = buildHuggingFaceFileList(info, allowPatterns, ignorePatterns);
    if (files.length === 0) {
      throw new Error("No downloadable files found for this model");
    }

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

    this.store.save(download);
    void this.runDownload(download.id, hfToken);
    return download;
  }

  /**
   * Ensure downloads fail synchronously with a useful setup error instead of
   * queueing a job that immediately dies with EACCES in the background.
   */
  private ensureModelsDirectoryWritable(): void {
    try {
      mkdirSync(this.config.models_dir, { recursive: true });
      accessSync(this.config.models_dir, constants.W_OK);
    } catch (error) {
      throw new Error(
        `Models directory is not writable by the controller: ${this.config.models_dir}. ` +
          `Update Settings → Models directory to a writable server path. ${String(error)}`,
      );
    }
  }

  public pause(id: string): ModelDownload {
    const download = this.store.get(id);
    if (!download) {
      throw new Error("Download not found");
    }
    download.status = "paused";
    download.updated_at = toTimestamp();
    this.store.save(download);
    this.abortActive(id);
    this.publishState(download, "paused");
    return download;
  }

  public resume(id: string, hfToken: string | null = null): ModelDownload {
    const download = this.store.get(id);
    if (!download) {
      throw new Error("Download not found");
    }
    if (download.status === "completed") {
      return download;
    }
    download.status = "queued";
    download.updated_at = toTimestamp();
    download.error = null;
    this.store.save(download);
    void this.runDownload(download.id, hfToken);
    this.publishState(download, "queued");
    return download;
  }

  public cancel(id: string): ModelDownload {
    const download = this.store.get(id);
    if (!download) {
      throw new Error("Download not found");
    }
    download.status = "canceled";
    download.updated_at = toTimestamp();
    this.store.save(download);
    this.abortActive(id);
    this.publishState(download, "canceled");
    return download;
  }

  private abortActive(id: string): void {
    const active = this.active.get(id);
    if (active) {
      active.controller.abort();
      this.active.delete(id);
    }
  }

  private async runDownload(id: string, hfToken: string | null): Promise<void> {
    const download = this.store.get(id);
    if (!download || download.status === "completed" || download.status === "canceled") {
      return;
    }
    if (this.active.has(id)) {
      return;
    }
    const controller = new AbortController();
    // Identity token for this run. pause() deletes the active entry and a
    // following resume() starts a NEW run that overwrites it; this token lets a
    // superseded old run detect it no longer owns the download and make zero
    // state writes (otherwise its abort-driven catch clobbers the live run's
    // status to "paused" and its finally deletes the live run's active entry).
    const self = { controller, running: true };
    this.active.set(id, self);
    const stillOwner = (): boolean => this.active.get(id) === self;

    let current = {
      ...download,
      status: "downloading" as DownloadStatus,
      updated_at: toTimestamp(),
    };
    this.store.save(current);
    this.publishState(current, "downloading");

    try {
      mkdirSync(current.target_dir, { recursive: true });

      for (const file of current.files) {
        if (controller.signal.aborted) {
          break;
        }
        if (current.status === "paused" || current.status === "canceled") {
          break;
        }
        if (file.status === "completed") {
          continue;
        }
        await this.downloadFile(current, file, controller, hfToken);
        current = this.store.get(id) ?? current;
      }

      // A newer run superseded this one (pause→resume): leave all state to it.
      if (!stillOwner()) {
        return;
      }
      current = this.store.get(id) ?? current;
      if (current.status === "paused" || current.status === "canceled") {
        return;
      }
      const allComplete = current.files.every((file) => file.status === "completed");
      current.status = allComplete ? "completed" : "failed";
      current.error = allComplete ? null : (current.error ?? "Download incomplete");
      current.downloaded_bytes = sumDownloadedBytes(current.files);
      current.total_bytes = current.total_bytes ?? sumTotalBytes(current.files);
      current.updated_at = toTimestamp();
      this.store.save(current);
      this.publishState(current, current.status);
    } catch (error) {
      // If a newer run already took over, this run's abort must not rewrite the
      // live download's status.
      if (!stillOwner()) {
        return;
      }
      const latest = this.store.get(id) ?? current;
      if (controller.signal.aborted) {
        latest.status = latest.status === "canceled" ? "canceled" : "paused";
      } else {
        latest.status = "failed";
      }
      latest.error = controller.signal.aborted ? latest.error : String(error);
      latest.downloaded_bytes = sumDownloadedBytes(latest.files);
      latest.updated_at = toTimestamp();
      this.store.save(latest);
      this.publishState(latest, latest.status);
      if (!controller.signal.aborted) {
        this.logger.error("Download failed", { error: String(error), id });
      }
    } finally {
      // Only clear the active entry if it is still ours — a newer run may have
      // replaced it.
      if (stillOwner()) {
        this.active.delete(id);
      }
    }
  }

  private async downloadFile(
    download: ModelDownload,
    file: DownloadFileInfo,
    controller: AbortController,
    hfToken: string | null,
  ): Promise<void> {
    const closeWriter = (writer: ReturnType<typeof createWriteStream>): Promise<void> =>
      new Promise((resolve, reject) => {
        writer.once("error", reject);
        writer.once("close", resolve);
        writer.end();
      });

    let currentDownload = download;
    const localPath = resolve(download.target_dir, ...sanitizePathSegments(file.path));
    const temporaryPath = `${localPath}.part`;
    mkdirSync(dirname(localPath), { recursive: true });

    const existingFinal = existsSync(localPath) ? statSync(localPath).size : 0;
    if (file.size_bytes && existingFinal >= file.size_bytes) {
      file.status = "completed";
      file.downloaded_bytes = file.size_bytes;
      currentDownload = this.persistFileUpdate(currentDownload, file);
      return;
    }

    const existing = existsSync(temporaryPath) ? statSync(temporaryPath).size : 0;
    const headers: Record<string, string> = {};
    if (hfToken) {
      headers["Authorization"] = `Bearer ${hfToken}`;
    }
    if (existing > 0) {
      headers["Range"] = `bytes=${existing}-`;
    }

    const url = `https://huggingface.co/${download.model_id}/resolve/${download.revision ?? "main"}/${file.path}`;
    file.status = "downloading";
    file.downloaded_bytes = existing;
    currentDownload = this.persistFileUpdate(currentDownload, file);

    const response = await this.fetchImpl(url, { headers, signal: controller.signal });
    if (response.status === 416) {
      if (file.size_bytes && existing >= file.size_bytes) {
        renameSync(temporaryPath, localPath);
        file.status = "completed";
        file.downloaded_bytes = file.size_bytes;
        currentDownload = this.persistFileUpdate(currentDownload, file);
        return;
      }
      throw new Error(`Download range not satisfiable for ${file.path}`);
    }
    if (!response.ok && response.status !== 206 && response.status !== 200) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }

    const shouldAppend = existing > 0 && response.status === 206;
    const baseExisting = shouldAppend ? existing : 0;
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (!file.size_bytes && contentLength > 0) {
      file.size_bytes = contentLength + baseExisting;
    }
    if (!shouldAppend && existing > 0) {
      file.downloaded_bytes = 0;
      currentDownload = this.persistFileUpdate(currentDownload, file);
    }
    const writer = createWriteStream(temporaryPath, { flags: shouldAppend ? "a" : "w" });
    const writerFailure = trackWriterFailure(writer);
    const reader = response.body?.getReader();
    if (!reader) {
      try {
        await closeWriter(writer);
      } finally {
        writerFailure.dispose();
      }
      throw new Error("Download response has no body");
    }

    let lastUpdate = Date.now();
    let downloaded = baseExisting;
    try {
      while (true) {
        writerFailure.throwIfFailed();
        const { done, value } = await reader.read();
        writerFailure.throwIfFailed();
        if (done) {
          break;
        }
        if (value) {
          const ok = writer.write(Buffer.from(value));
          writerFailure.throwIfFailed();
          if (!ok) {
            await waitForWriterDrain(writer);
            writerFailure.throwIfFailed();
          }
          downloaded += value.length;
          file.downloaded_bytes = downloaded;
          if (Date.now() - lastUpdate > DOWNLOAD_PROGRESS_THROTTLE_MS) {
            currentDownload = this.persistFileUpdate(currentDownload, file);
            this.publishProgress(currentDownload, file);
            lastUpdate = Date.now();
          }
        }
      }
    } finally {
      try {
        await closeWriter(writer);
      } finally {
        writerFailure.dispose();
      }
    }

    file.downloaded_bytes = downloaded;
    if (file.size_bytes && downloaded < file.size_bytes) {
      file.status = "error";
      currentDownload = this.persistFileUpdate(currentDownload, file);
      throw new Error(`Incomplete download for ${file.path}`);
    }

    renameSync(temporaryPath, localPath);
    file.status = "completed";
    currentDownload = this.persistFileUpdate(currentDownload, file);
    this.publishProgress(currentDownload, file);
  }

  private persistFileUpdate(download: ModelDownload, file: DownloadFileInfo): ModelDownload {
    const latest = this.store.get(download.id) ?? download;
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
    this.store.save(updated);
    return updated;
  }

  private publishProgress(download: ModelDownload, file: DownloadFileInfo): void {
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
    void this.eventManager.publish(new Event(CONTROLLER_EVENTS.DOWNLOAD_PROGRESS, payload));
  }

  private publishState(download: ModelDownload, status: DownloadStatus): void {
    const payload = {
      id: download.id,
      model_id: download.model_id,
      status,
      downloaded_bytes: download.downloaded_bytes,
      total_bytes: download.total_bytes,
      error: download.error,
    };
    void this.eventManager.publish(new Event(CONTROLLER_EVENTS.DOWNLOAD_STATE, payload));
  }
}
