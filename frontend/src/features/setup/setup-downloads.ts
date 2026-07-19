import type { ModelDownload, StarterPreset } from "@/lib/types";

const ACTIVE_DOWNLOAD_STATUSES = new Set(["queued", "downloading", "paused"]);

const patternMatches = (value: string, pattern: string): boolean => {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i").test(value);
};

export function downloadMatchesPreset(
  download: ModelDownload,
  preset: StarterPreset | null,
): boolean {
  const patterns = preset?.allow_patterns ?? [];
  if (patterns.length === 0) return true;
  return download.files.some((file) =>
    patterns.some((pattern) => patternMatches(file.path, pattern)),
  );
}

export function selectSetupDownload(
  downloads: ModelDownload[],
  modelId: string,
  preset: StarterPreset | null,
): ModelDownload | null {
  if (!modelId) return null;
  const matching = downloads.filter(
    (download) => download.model_id === modelId && downloadMatchesPreset(download, preset),
  );
  return (
    matching.find((download) => download.status === "completed") ??
    matching.find((download) => ACTIVE_DOWNLOAD_STATUSES.has(download.status)) ??
    matching[0] ??
    null
  );
}

export function countAdditionalQueuedDownloads(
  downloads: ModelDownload[],
  activeDownloadId?: string,
): number {
  return downloads.filter(
    (download) => download.id !== activeDownloadId && ACTIVE_DOWNLOAD_STATUSES.has(download.status),
  ).length;
}
