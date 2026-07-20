import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ModelDownload, StarterPreset } from "@/lib/types";
import { countAdditionalQueuedDownloads, selectSetupDownload } from "./setup-downloads";

const download = (id: string, status: ModelDownload["status"], file: string): ModelDownload => ({
  id,
  model_id: "org/model",
  revision: null,
  status,
  created_at: "2026-07-19T00:00:00.000Z",
  updated_at: "2026-07-19T00:00:00.000Z",
  target_dir: "/models/org/model",
  total_bytes: 100,
  downloaded_bytes: status === "completed" ? 100 : 0,
  files: [{ path: file, size_bytes: 100, downloaded_bytes: 0, status: "pending" }],
  error: null,
});

const preset: StarterPreset = {
  id: "q1",
  name: "Q1",
  description: "Q1",
  kind: "download",
  tags: [],
  size_gb: null,
  min_vram_gb: null,
  model_id: "org/model",
  allow_patterns: ["*Q1.gguf"],
};

describe("setup download selection", () => {
  test("prefers the completed matching variant over stale canceled records", () => {
    const downloads = [
      download("canceled", "canceled", "model-Q1.gguf"),
      download("wrong", "completed", "model-Q4.gguf"),
      download("complete", "completed", "model-Q1.gguf"),
    ];
    assert.equal(selectSetupDownload(downloads, "org/model", preset)?.id, "complete");
  });

  test("counts only work that is active or resumable", () => {
    const downloads = [
      download("active", "downloading", "model-Q1.gguf"),
      download("queued", "queued", "model-Q1.gguf"),
      download("paused", "paused", "model-Q1.gguf"),
      download("done", "completed", "model-Q1.gguf"),
      download("old", "canceled", "model-Q1.gguf"),
    ];
    assert.equal(countAdditionalQueuedDownloads(downloads, "active"), 2);
  });
});
