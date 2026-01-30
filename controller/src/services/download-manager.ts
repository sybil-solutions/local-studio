// CRITICAL
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import type { Config } from "../config/env";
import type { Logger } from "../core/logger";
import { Event, type EventManager } from "./event-manager";
import type { DownloadFileInfo, DownloadStatus, ModelDownload } from "../types/models";
import type { DownloadStore } from "../stores/download-store";

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

type HuggingFaceModelInfo = {
  modelId?: string;
  sha?: string;
  siblings?: Array<{ rfilename: string; size?: number | null }>;
};

const DEFAULT_IGNORE = [".gitattributes", ".gitignore"];
const PROGRESS_THROTTLE_MS = 750;

const toTimestamp = (): string => new Date().toISOString();

const compileGlob = (pattern: string): RegExp => {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regex = "^" + escaped.replace(/\*/g, ".*") + "$";
  return new RegExp(regex, "i");
};

const matchesAny = (value: string, patterns: string[]): boolean => {
  if (patterns.length === 0) {
    return false;
  }
  return patterns.some((pattern) => compileGlob(pattern).test(value));
};

const sanitizePathSegments = (value: string): string[] => {
  return value
    .split(/[\\/]/)
    .map((segment) => segment.trim())
    .filter((segment) => Boolean(segment) && segment !== "." && segment !== "..");
};

const resolveDownloadRoot = (config: Config, modelId: string, destination?: string | null): string => {
  const base = resolve(config.models_dir);
  const segments = destination ? sanitizePathSegments(destination) : sanitizePathSegments(modelId);
  const target = resolve(base, ...segments);
  const normalizedBase = base.endsWith(sep) ? base : base + sep;
  if (!target.startsWith(normalizedBase)) {
    throw new Error("Invalid destination path");
  }
  return target;
};

const buildFileList = (
  modelInfo: HuggingFaceModelInfo,
  allowPatterns: string[],
  ignorePatterns: string[],
): DownloadFileInfo[] => {
  const siblings = modelInfo.siblings ?? [];
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

const sumBytes = (files: DownloadFileInfo[]): number => {
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

/**
 *
 */
export class DownloadManager {
  private readonly active = new Map<string, ActiveDownload>();

  /**
   * Creates a new DownloadManager instance.
   * @param config - Application configuration.
   * @param store - Download persistence store.
   * @param eventManager - Event broadcasting manager.
   * @param logger - Logger instance.
   */
  public constructor(
    private readonly config: Config,
    private readonly store: DownloadStore,
    private readonly eventManager: EventManager,
    private readonly logger: Logger,
  ) {
    this.rehydrate();
  }

  /**
   * Reset in-flight downloads after restart.
   * @returns void
   */
  private rehydrate(): void {
    const downloads = this.store.list();
    for (const download of downloads) {
      if (download.status === "downloading" || download.status === "queued") {
        const updated = { ...download, status: "paused" as DownloadStatus, error: "Restart required" };
        this.store.save(updated);
      }
    }
  }

  /**
   * List downloads.
   * @returns Downloads list.
   */
  public list(): ModelDownload[] {
    return this.store.list();
  }

  /**
   * Get a download entry.
   * @param id - Download id.
   * @returns Download or null.
   */
  public get(id: string): ModelDownload | null {
    return this.store.get(id);
  }

  /**
   * Start a new download.
   * @param request - Download request payload.
   * @returns Download record.
   */
  public async start(request: DownloadRequest): Promise<ModelDownload> {
    const modelId = request.model_id?.trim();
    if (!modelId) {
      throw new Error("Model id is required");
    }
    const allowPatterns = (request.allow_patterns ?? []).filter(Boolean);
    const ignorePatterns = [...DEFAULT_IGNORE, ...(request.ignore_patterns ?? []).filter(Boolean)];
    const targetDirectory = resolveDownloadRoot(this.config, modelId, request.destination_dir);
    const hfToken = request.hf_token ?? null;

    const info = await this.fetchModelInfo(modelId, request.revision, hfToken);
    const files = buildFileList(info, allowPatterns, ignorePatterns);
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
   * Pause a download.
   * @param id - Download id.
   * @returns Updated download.
   */
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

  /**
   * Resume a download.
   * @param id - Download id.
   * @param hfToken
   * @returns Updated download.
   */
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

  /**
   * Cancel a download.
   * @param id - Download id.
   * @returns Updated download.
   */
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

  /**
   * Aborts an active download by id.
   * @param id - Download id to abort.
   */
  private abortActive(id: string): void {
    const active = this.active.get(id);
    if (active) {
      active.controller.abort();
      this.active.delete(id);
    }
  }

  /**
   * Fetches model information from HuggingFace API.
   * @param modelId - The model id to fetch info for.
   * @param revision - Optional revision/branch.
   * @param hfToken - Optional HuggingFace token.
   * @returns Model information from HuggingFace.
   */
  private async fetchModelInfo(modelId: string, revision?: string | null, hfToken?: string | null): Promise<HuggingFaceModelInfo> {
    const url = new URL(`https://huggingface.co/api/models/${encodeURIComponent(modelId)}`);
    if (revision) {
      url.searchParams.set("revision", revision);
    }
    const headers: Record<string, string> = {};
    if (hfToken) {
      headers["Authorization"] = `Bearer ${hfToken}`;
    }
    const response = await fetch(url.toString(), { headers });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Hugging Face API error: ${response.status} ${text}`);
    }
    return (await response.json()) as HuggingFaceModelInfo;
  }

  /**
   * Runs the download process for a given download id.
   * @param id - Download id to process.
   * @param hfToken - Optional HuggingFace token.
   */
  private async runDownload(id: string, hfToken: string | null): Promise<void> {
    const download = this.store.get(id);
    if (!download || download.status === "completed" || download.status === "canceled") {
      return;
    }
    if (this.active.has(id)) {
      return;
    }
    const controller = new AbortController();
    this.active.set(id, { controller, running: true });

    let current = { ...download, status: "downloading" as DownloadStatus, updated_at: toTimestamp() };
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

      current = this.store.get(id) ?? current;
      if (current.status === "paused" || current.status === "canceled") {
        return;
      }
      const allComplete = current.files.every((file) => file.status === "completed");
      current.status = allComplete ? "completed" : "failed";
      current.error = allComplete ? null : current.error ?? "Download incomplete";
      current.downloaded_bytes = sumBytes(current.files);
      current.total_bytes = current.total_bytes ?? sumTotalBytes(current.files);
      current.updated_at = toTimestamp();
      this.store.save(current);
      this.publishState(current, current.status);
    } catch (error) {
      const latest = this.store.get(id) ?? current;
      if (controller.signal.aborted) {
        latest.status = latest.status === "canceled" ? "canceled" : "paused";
      } else {
        latest.status = "failed";
      }
      latest.error = controller.signal.aborted ? latest.error : String(error);
      latest.downloaded_bytes = sumBytes(latest.files);
      latest.updated_at = toTimestamp();
      this.store.save(latest);
      this.publishState(latest, latest.status);
      if (!controller.signal.aborted) {
        this.logger.error("Download failed", { error: String(error), id });
      }
    } finally {
      this.active.delete(id);
    }
  }

  /**
   * Downloads a single file from HuggingFace.
   * @param download - The parent download record.
   * @param file - File information to download.
   * @param controller - Abort controller for cancellation.
   * @param hfToken - Optional HuggingFace token.
   */
  private async downloadFile(
    download: ModelDownload,
    file: DownloadFileInfo,
    controller: AbortController,
    hfToken: string | null,
  ): Promise<void> {
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

    const response = await fetch(url, { headers, signal: controller.signal });
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
    const reader = response.body?.getReader();
    if (!reader) {
      writer.close();
      throw new Error("Download response has no body");
    }

    let lastUpdate = Date.now();
    let downloaded = baseExisting;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (value) {
          writer.write(Buffer.from(value));
          downloaded += value.length;
          file.downloaded_bytes = downloaded;
          if (Date.now() - lastUpdate > PROGRESS_THROTTLE_MS) {
            currentDownload = this.persistFileUpdate(currentDownload, file);
            this.publishProgress(currentDownload, file);
            lastUpdate = Date.now();
          }
        }
      }
    } finally {
      writer.close();
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

  /**
   * Persists file download progress to the store.
   * @param download - The parent download record.
   * @param file - Updated file information.
   * @returns Updated download record.
   */
  private persistFileUpdate(download: ModelDownload, file: DownloadFileInfo): ModelDownload {
    const latest = this.store.get(download.id) ?? download;
    const updatedFiles = latest.files.map((entry) => (entry.path === file.path ? { ...file } : entry));
    const updated: ModelDownload = {
      ...latest,
      files: updatedFiles,
      downloaded_bytes: sumBytes(updatedFiles),
      total_bytes: latest.total_bytes ?? sumTotalBytes(updatedFiles),
      updated_at: toTimestamp(),
    };
    this.store.save(updated);
    return updated;
  }

  /**
   * Publishes download progress event.
   * @param download - The download record.
   * @param file - Current file being processed.
   */
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
    void this.eventManager.publish(new Event("download_progress", payload));
  }

  /**
   * Publishes download state change event.
   * @param download - The download record.
   * @param status - New status value.
   */
  private publishState(download: ModelDownload, status: DownloadStatus): void {
    const payload = {
      id: download.id,
      model_id: download.model_id,
      status,
      downloaded_bytes: download.downloaded_bytes,
      total_bytes: download.total_bytes,
      error: download.error,
    };
    void this.eventManager.publish(new Event("download_state", payload));
  }
}
