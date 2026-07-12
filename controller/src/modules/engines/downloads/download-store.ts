import type { ModelDownload } from "../types";
import { JsonBlobStore } from "../../../stores/json-blob-store";

function decodeModelDownload(data: string): ModelDownload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record["id"] !== "string" || typeof record["model_id"] !== "string") return null;
  return record as unknown as ModelDownload;
}

export class DownloadStore extends JsonBlobStore<ModelDownload> {
  public constructor(dbPath: string) {
    super(dbPath, "model_downloads", {
      orderBy: "updated_at DESC",
      idOf: (download) => download.id,
      decode: decodeModelDownload,
    });
  }
}
