import { describe, expect, test } from "bun:test";
import type { DownloadFileInfo, ModelDownload } from "../types";
import { findReusableDownload } from "./download-manager";

const file = (path: string): DownloadFileInfo => ({
  path,
  size_bytes: 100,
  downloaded_bytes: 0,
  status: "pending",
});

const download = (
  id: string,
  status: ModelDownload["status"],
  files: DownloadFileInfo[],
): ModelDownload => ({
  id,
  model_id: "org/model",
  revision: null,
  status,
  created_at: "2026-07-19T00:00:00.000Z",
  updated_at: "2026-07-19T00:00:00.000Z",
  target_dir: "/models/org/model",
  total_bytes: 100,
  downloaded_bytes: 0,
  files,
  error: null,
});

describe("download reuse", () => {
  test("prefers a completed exact file set", () => {
    const result = findReusableDownload(
      [
        download("queued", "queued", [file("model-Q1.gguf")]),
        download("completed", "completed", [file("model-Q1.gguf")]),
      ],
      "org/model",
      "/models/org/model",
      [file("model-Q1.gguf")],
    );
    expect(result?.id).toBe("completed");
  });

  test("does not reuse a different GGUF variant", () => {
    const result = findReusableDownload(
      [download("wrong", "completed", [file("model-Q4.gguf")])],
      "org/model",
      "/models/org/model",
      [file("model-Q1.gguf")],
    );
    expect(result).toBeNull();
  });
});
