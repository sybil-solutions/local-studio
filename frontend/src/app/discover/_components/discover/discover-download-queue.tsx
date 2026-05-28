import { Pause, Play, XCircle } from "lucide-react";
import type { ModelDownload } from "@/lib/types";

const renderDownloadStatus = (download: ModelDownload) => {
  const total = download.total_bytes ?? 0;
  const progress =
    total > 0 ? Math.min(100, Math.round((download.downloaded_bytes / total) * 100)) : 0;
  const statusLabel = download.status.replace("_", " ");

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-xs text-(--dim)">
        <span className="uppercase tracking-wide">{statusLabel}</span>
        {total > 0 && <span>{progress}%</span>}
      </div>
      <div className="h-1.5 w-full rounded-full bg-(--surface)">
        <div
          className="h-1.5 rounded-full bg-(--hl1) transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>
      {download.error && download.status === "failed" && (
        <div className="text-xs text-(--err)">{download.error}</div>
      )}
    </div>
  );
};

export function DiscoverDownloadQueue({
  downloads,
  onPauseDownload,
  onResumeDownload,
  onCancelDownload,
}: {
  downloads: ModelDownload[];
  onPauseDownload: (downloadId: string) => Promise<void>;
  onResumeDownload: (downloadId: string) => Promise<void>;
  onCancelDownload: (downloadId: string) => Promise<void>;
}) {
  if (downloads.length === 0) return null;

  return (
    <div className="mb-5 border border-(--border) rounded-lg bg-(--surface) p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-medium">Download Queue</div>
        <div className="text-xs text-(--dim)">{downloads.length} active</div>
      </div>
      <div className="space-y-3">
        {downloads.map((download) => (
          <div key={download.id} className="flex items-center justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{download.model_id}</div>
              {renderDownloadStatus(download)}
            </div>
            <div className="flex items-center gap-2">
              {download.status === "downloading" && (
                <button
                  onClick={() => onPauseDownload(download.id)}
                  className="p-2 rounded-lg border border-(--border) hover:bg-(--surface)"
                  title="Pause"
                >
                  <Pause className="h-4 w-4" />
                </button>
              )}
              {(download.status === "paused" || download.status === "failed") && (
                <button
                  onClick={() => onResumeDownload(download.id)}
                  className="p-2 rounded-lg border border-(--border) hover:bg-(--surface)"
                  title="Resume"
                >
                  <Play className="h-4 w-4" />
                </button>
              )}
              {download.status !== "completed" && download.status !== "canceled" && (
                <button
                  onClick={() => onCancelDownload(download.id)}
                  className="p-2 rounded-lg border border-(--border) hover:bg-(--surface) text-(--err)"
                  title="Cancel"
                >
                  <XCircle className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
