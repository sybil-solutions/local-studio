"use client";

import { Pause, Play, X } from "lucide-react";
import { useDownloads } from "@/hooks/use-downloads";
import { formatBytes } from "@/lib/formatters";
import type { ModelDownload } from "@/lib/types";
import { ModelButton, ModelRow, ModelSection, ModelStatus, ModelValue } from "@/ui";

export function downloadProgressText(
  download: Pick<ModelDownload, "downloaded_bytes" | "total_bytes">,
): string {
  const total = download.total_bytes ?? 0;
  if (total <= 0) return `${formatBytes(download.downloaded_bytes)} / unavailable`;
  const progress = Math.min(100, Math.round((download.downloaded_bytes / total) * 100));
  return `${formatBytes(download.downloaded_bytes)} / ${formatBytes(total)} · ${progress}%`;
}

export function downloadSpeedText(
  download: Pick<ModelDownload, "speed_bytes_per_second">,
): string | null {
  const speed = download.speed_bytes_per_second ?? 0;
  return speed > 0 ? `${formatBytes(speed)}/s` : null;
}

export function downloadCompletedText(
  download: Pick<ModelDownload, "status" | "completed_at" | "updated_at">,
): string | null {
  if (download.status !== "completed") return null;
  return `done ${download.completed_at || download.updated_at}`;
}

export function DownloadsTab() {
  const { downloads, error, pauseDownload, resumeDownload, cancelDownload } = useDownloads();
  return (
    <ModelSection
      title="Downloads"
      description="Models the user requested, with server-side state, progress, speed, errors, and controls."
      actions={
        <ModelStatus tone={error ? "danger" : downloads.length ? "info" : "default"}>
          {error ? "error" : `${downloads.length} rows`}
        </ModelStatus>
      }
    >
      {error ? (
        <ModelRow
          label="Download worker"
          description="Controller download endpoint returned an error."
          value={<ModelValue dim>{error}</ModelValue>}
          status={<ModelStatus tone="danger">error</ModelStatus>}
        />
      ) : null}
      {downloads.length === 0 ? (
        <ModelRow
          label="No downloads"
          description="Click Download from Search Models to populate this section."
          value={<ModelValue dim>Queue is empty</ModelValue>}
          status={<ModelStatus>idle</ModelStatus>}
        />
      ) : (
        downloads.map((download) => {
          const source = download.source || "Hugging Face";
          const speed = downloadSpeedText(download);
          const completed = downloadCompletedText(download);
          return (
            <ModelRow
              key={download.id}
              label={download.model_id}
              description={`${source} · ${download.target_dir}`}
              value={
                <ModelValue mono>
                  {[downloadProgressText(download), speed, completed].filter(Boolean).join(" · ")}
                </ModelValue>
              }
              status={
                <ModelStatus tone={download.status === "failed" ? "danger" : "info"}>
                  {download.status}
                </ModelStatus>
              }
              actions={
                <>
                  {download.status === "downloading" ? (
                    <ModelButton onClick={() => void pauseDownload(download.id)}>
                      <Pause className="h-3 w-3" />
                    </ModelButton>
                  ) : null}
                  {download.status === "paused" || download.status === "failed" ? (
                    <ModelButton onClick={() => void resumeDownload(download.id)}>
                      <Play className="h-3 w-3" />
                      Retry
                    </ModelButton>
                  ) : null}
                  {download.status !== "completed" && download.status !== "canceled" ? (
                    <ModelButton tone="danger" onClick={() => void cancelDownload(download.id)}>
                      <X className="h-3 w-3" />
                    </ModelButton>
                  ) : null}
                </>
              }
            >
              {download.error ? (
                <div className="text-[11px] text-(--err)">{download.error}</div>
              ) : null}
            </ModelRow>
          );
        })
      )}
    </ModelSection>
  );
}
