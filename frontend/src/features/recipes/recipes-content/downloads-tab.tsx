"use client";

import { Pause, Play, Plus, X } from "@/ui/icon-registry";
import { useDownloads } from "@/features/recipes/use-downloads";
import { formatBytes } from "@/lib/formatters";
import type { ModelDownload } from "@/lib/types";
import { ModelLogo } from "@/ui/model-logo";
import {
  DataRow,
  EndCell,
  HeadCell,
  LeadCell,
  NumCell,
  RowAction,
  StatusText,
  TableFrame,
  TableNotice,
} from "./catalog-table-shell";

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

function progressPercent(download: ModelDownload): number | null {
  const total = download.total_bytes ?? 0;
  if (total <= 0) return null;
  return Math.min(100, Math.round((download.downloaded_bytes / total) * 100));
}

/**
 * The queue, drawn on the catalog's table so a download reads as the same kind
 * of object as the model it came from. Progress is the one number set in full
 * strength — it is the only thing on this page that is still changing.
 */
export function DownloadsTab({
  onCreateServe,
}: {
  onCreateServe: (download: ModelDownload) => void;
}) {
  const { downloads, error, pauseDownload, resumeDownload, cancelDownload } = useDownloads();

  if (error) {
    return (
      <TableNotice
        title="The download worker is not responding"
        body={error}
        action={
          <span className="text-[length:var(--fs-sm)] text-(--dim)">
            Downloads already on disk are unaffected — the controller reports queue state again as
            soon as it recovers.
          </span>
        }
      />
    );
  }

  if (downloads.length === 0) {
    return (
      <TableNotice
        title="Nothing downloading"
        body="Pull weights from Recommended or Search Hugging Face and they appear here with progress, speed, and retry."
      />
    );
  }

  return (
    <TableFrame minWidthClass="min-w-[42rem]">
      <thead>
        <tr>
          <HeadCell>Model</HeadCell>
          <HeadCell numeric>Progress</HeadCell>
          <HeadCell numeric title="Bytes fetched out of the repository's total size">
            Downloaded
          </HeadCell>
          <HeadCell numeric>Speed</HeadCell>
          <HeadCell numeric>Status</HeadCell>
        </tr>
      </thead>
      <tbody>
        {downloads.map((download) => (
          <DownloadRow
            key={download.id}
            download={download}
            onPause={() => void pauseDownload(download.id)}
            onResume={() => void resumeDownload(download.id)}
            onCancel={() => void cancelDownload(download.id)}
            onCreateServe={() => onCreateServe(download)}
          />
        ))}
      </tbody>
    </TableFrame>
  );
}

function DownloadRow({
  download,
  onPause,
  onResume,
  onCancel,
  onCreateServe,
}: {
  download: ModelDownload;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onCreateServe: () => void;
}) {
  const percent = progressPercent(download);
  const total = download.total_bytes ?? 0;
  const inactive = download.status === "canceled" || download.status === "completed";

  return (
    <DataRow dimmed={download.status === "canceled"}>
      <LeadCell>
        <div className="flex min-w-0 items-center gap-2.5">
          <ModelLogo modelId={download.model_id} size="sm" className="rounded-md" />
          <div className="min-w-0">
            <div
              className="truncate text-[length:var(--fs-md)] font-medium text-(--fg)"
              title={download.model_id}
            >
              {download.model_id}
            </div>
            <div
              className="truncate text-[length:var(--fs-xs)] text-(--dim)/60"
              title={download.target_dir}
            >
              {download.source || "Hugging Face"} · {download.target_dir}
            </div>
          </div>
        </div>
      </LeadCell>

      <NumCell strong={!inactive}>{percent == null ? "—" : `${percent}%`}</NumCell>

      <NumCell>
        {formatBytes(download.downloaded_bytes)}
        {total > 0 ? <span className="text-(--dim)/60"> / {formatBytes(total)}</span> : null}
      </NumCell>

      <NumCell>{downloadSpeedText(download) ?? "—"}</NumCell>

      <EndCell>
        <DownloadStatusCell
          download={download}
          onPause={onPause}
          onResume={onResume}
          onCancel={onCancel}
          onCreateServe={onCreateServe}
        />
      </EndCell>
    </DataRow>
  );
}

/**
 * Status states what the queue is doing; the action that changes it appears on
 * hover, so a queue of ten rows is not a wall of buttons.
 */
function DownloadStatusCell({
  download,
  onPause,
  onResume,
  onCancel,
  onCreateServe,
}: {
  download: ModelDownload;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onCreateServe: () => void;
}) {
  if (download.status === "completed") {
    return (
      <div className="flex items-center justify-end gap-2">
        <StatusText>on disk</StatusText>
        <RowAction onClick={onCreateServe} title="Create a server from these weights">
          <Plus className="h-3 w-3" />
          Server
        </RowAction>
      </div>
    );
  }
  if (download.status === "downloading") {
    return (
      <div className="flex items-center justify-end gap-2">
        <StatusText>downloading</StatusText>
        <RowAction onClick={onPause} tone="quiet" title="Pause this download">
          <Pause className="h-3 w-3" />
          Pause
        </RowAction>
        <RowAction onClick={onCancel} tone="danger" title="Cancel this download">
          <X className="h-3 w-3" />
        </RowAction>
      </div>
    );
  }
  if (download.status === "paused" || download.status === "failed") {
    const failed = download.status === "failed";
    return (
      <div className="flex items-center justify-end gap-2">
        {/* The failure reason is a whole sentence from the controller, so it
            rides in the tooltip rather than stretching the column. */}
        <span title={failed ? (download.error ?? undefined) : undefined}>
          <StatusText tone={failed ? "error" : "dim"}>{failed ? "failed" : "paused"}</StatusText>
        </span>
        <RowAction onClick={onResume} title="Resume this download">
          <Play className="h-3 w-3" />
          Retry
        </RowAction>
        <RowAction onClick={onCancel} tone="danger" title="Cancel this download">
          <X className="h-3 w-3" />
        </RowAction>
      </div>
    );
  }
  return <StatusText>{download.status}</StatusText>;
}
