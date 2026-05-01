// CRITICAL
import type { DownloadFileInfo } from "../types";

export const sumDownloadedBytes = (files: DownloadFileInfo[]): number => {
  return files.reduce((total, file) => total + (file.downloaded_bytes || 0), 0);
};

export const sumTotalBytes = (files: DownloadFileInfo[]): number | null => {
  const known = files.filter((file) => typeof file.size_bytes === "number") as Array<
    DownloadFileInfo & { size_bytes: number }
  >;
  if (known.length === 0) {
    return null;
  }
  return known.reduce((total, file) => total + file.size_bytes, 0);
};
