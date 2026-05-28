import type { HuggingFaceModel, ModelDownload } from "@/lib/types";
import { extractProvider, extractQuantizations } from "../../utils";

export type ModelRowDownloadAction =
  | {
      kind: "active";
      canPause: boolean;
      canResume: boolean;
      downloadId: string;
      label: string | null;
    }
  | { kind: "download"; modelId: string }
  | { kind: "ready" }
  | { kind: "starting" };

export interface ModelRowView {
  downloadAction: ModelRowDownloadAction;
  hasVariants: boolean;
  modelUrl: string;
  provider: string;
  quantizations: string[];
  rowClasses: string;
  variantLabel: string | null;
}

interface ModelRowViewInput {
  activeDownload: ModelDownload | null;
  child: boolean;
  isLocal: boolean;
  isStarting: boolean;
  model: HuggingFaceModel;
  variantCount: number;
}

/**
 * Resolve derived display state for a discover model row.
 * @param input - Row inputs from the discover results list.
 * @returns The display model used by the row renderer.
 */
export function resolveModelRowView(input: ModelRowViewInput): ModelRowView {
  const hasVariants = input.variantCount > 1;
  return {
    downloadAction: resolveDownloadAction(input),
    hasVariants,
    modelUrl: `https://huggingface.co/${input.model.modelId}`,
    provider: extractProvider(input.model.modelId),
    quantizations: extractQuantizations(input.model.tags),
    rowClasses: input.child
      ? "bg-(--surface)/15 hover:bg-(--surface)/25 transition-colors"
      : "hover:bg-(--surface)/30 transition-colors",
    variantLabel:
      !input.child && hasVariants ? `${input.variantCount} quantization variants` : null,
  };
}

function resolveDownloadAction(input: ModelRowViewInput): ModelRowDownloadAction {
  if (input.isLocal) {
    return { kind: "ready" };
  }
  if (input.isStarting) {
    return { kind: "starting" };
  }
  if (input.activeDownload) {
    return activeDownloadAction(input.activeDownload);
  }
  return { kind: "download", modelId: input.model.modelId };
}

function activeDownloadAction(activeDownload: ModelDownload): ModelRowDownloadAction {
  return {
    kind: "active",
    canPause: activeDownload.status === "downloading",
    canResume: activeDownload.status === "paused" || activeDownload.status === "failed",
    downloadId: activeDownload.id,
    label: activeDownloadLabel(activeDownload.status),
  };
}

function activeDownloadLabel(status: ModelDownload["status"]): string | null {
  if (status === "completed") {
    return "Downloaded";
  }
  if (status === "downloading" || status === "queued") {
    return "Downloading…";
  }
  return null;
}
