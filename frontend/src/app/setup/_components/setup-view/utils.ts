import type { ModelDownload } from "@/lib/types";
import { formatBytes } from "@/lib/formatters";

export const setupSteps = ["Welcome", "Hardware", "Model", "Download", "Launch", "Benchmark"];

export { formatBytes };

export const progressPercent = (download: ModelDownload | null): number => {
  if (!download?.total_bytes) return 0;
  return Math.min(100, Math.round((download.downloaded_bytes / download.total_bytes) * 100));
};
