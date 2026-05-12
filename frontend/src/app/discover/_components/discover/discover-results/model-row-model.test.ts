import { describe, expect, it } from "vitest";
import type { HuggingFaceModel, ModelDownload } from "@/lib/types";
import { resolveModelRowView } from "./model-row-model";

const model = (overrides: Partial<HuggingFaceModel> = {}): HuggingFaceModel => ({
  _id: "model-id",
  modelId: "meta-llama/Llama-3.1-8B-Instruct-AWQ",
  downloads: 1000,
  likes: 25,
  tags: ["text-generation", "awq"],
  private: false,
  ...overrides,
});

const download = (overrides: Partial<ModelDownload> = {}): ModelDownload => ({
  id: "download-id",
  model_id: "meta-llama/Llama-3.1-8B-Instruct-AWQ",
  revision: null,
  status: "downloading",
  created_at: "2026-05-12T00:00:00Z",
  updated_at: "2026-05-12T00:00:00Z",
  target_dir: "/models",
  total_bytes: null,
  downloaded_bytes: 0,
  files: [],
  error: null,
  ...overrides,
});

describe("model row model", () => {
  it("derives provider, quantization, model link, and variant copy", () => {
    expect(
      resolveModelRowView({
        activeDownload: null,
        child: false,
        isLocal: false,
        isStarting: false,
        model: model(),
        variantCount: 3,
      }),
    ).toMatchObject({
      hasVariants: true,
      modelUrl: "https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct-AWQ",
      provider: "meta-llama",
      quantizations: ["AWQ"],
      variantLabel: "3 quantization variants",
    });
  });

  it("prioritizes ready and starting states over download actions", () => {
    expect(
      resolveModelRowView({
        activeDownload: download(),
        child: false,
        isLocal: true,
        isStarting: true,
        model: model(),
        variantCount: 1,
      }).downloadAction,
    ).toEqual({ kind: "ready" });

    expect(
      resolveModelRowView({
        activeDownload: download(),
        child: false,
        isLocal: false,
        isStarting: true,
        model: model(),
        variantCount: 1,
      }).downloadAction,
    ).toEqual({ kind: "starting" });
  });

  it("maps active download controls and labels", () => {
    expect(
      resolveModelRowView({
        activeDownload: download({ status: "downloading" }),
        child: false,
        isLocal: false,
        isStarting: false,
        model: model(),
        variantCount: 1,
      }).downloadAction,
    ).toEqual({
      canPause: true,
      canResume: false,
      downloadId: "download-id",
      kind: "active",
      label: "Downloading…",
    });

    expect(
      resolveModelRowView({
        activeDownload: download({ status: "failed" }),
        child: false,
        isLocal: false,
        isStarting: false,
        model: model(),
        variantCount: 1,
      }).downloadAction,
    ).toMatchObject({ canPause: false, canResume: true, label: null });
  });
});
