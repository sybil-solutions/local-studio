/**
 * Model download + storage types.
 */

export type DownloadStatus =
  | "queued"
  | "downloading"
  | "paused"
  | "completed"
  | "failed"
  | "canceled";

export type DownloadFileStatus = "pending" | "downloading" | "completed" | "error";

export interface DownloadFileInfo {
  path: string;
  size_bytes: number | null;
  downloaded_bytes: number;
  status: DownloadFileStatus;
}

export interface ModelDownload {
  id: string;
  model_id: string;
  revision: string | null;
  status: DownloadStatus;
  source?: string | null;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
  target_dir: string;
  total_bytes: number | null;
  downloaded_bytes: number;
  speed_bytes_per_second?: number | null;
  files: DownloadFileInfo[];
  error: string | null;
}

export interface StorageInfo {
  models_dir: string;
  model_count: number;
  model_bytes: number;
  disk: {
    path: string;
    total_bytes: number | null;
    free_bytes: number | null;
    available_bytes: number | null;
  };
}
