import { memo, useCallback, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  DownloadCloud,
  ExternalLink,
  Pause,
  Play,
} from "lucide-react";
import type { HuggingFaceModel, ModelDownload } from "@/lib/types";
import { formatBytes, formatNumber } from "@/lib/formatters";
import { ModelButton, ModelLogo, ModelRow, ModelStatus, type ModelStatusTone } from "@/ui";
import { extractProvider, extractQuantizations } from "@/ui/discover/utils";
import type { ModelFit } from "./hardware-profile";

function ExploreVramCell({
  needGb,
  poolGb,
  fit,
}: {
  needGb: number | null;
  poolGb: number;
  fit?: ModelFit;
}) {
  if (needGb == null || !Number.isFinite(needGb)) {
    return (
      <span className="text-xs text-(--dim)" title={fit?.reason}>
        —
      </span>
    );
  }
  const label = needGb < 10 ? needGb.toFixed(1) : Math.round(needGb).toString();
  if (poolGb <= 0) {
    return (
      <span
        className="text-xs text-(--dim)"
        title={fit?.reason ?? "Rough weight estimate from name and tags"}
      >
        ~{label} GB
      </span>
    );
  }
  const over = needGb > poolGb;
  return (
    <span
      className={`text-xs ${over ? "text-(--err)" : "text-(--dim)"}`}
      title={fit?.reason ?? "Estimated footprint vs pooled GPU VRAM"}
    >
      ~{label} / {Math.round(poolGb)} GB
    </span>
  );
}

export const ExploreModelRow = memo(function ExploreModelRow({
  model,
  isLocal,
  activeDownload,
  isStarting,
  onStartDownload,
  onPauseDownload,
  onResumeDownload,
  variantCount,
  expanded,
  onToggleExpand,
  child,
  displayDownloads,
  displayLikes,
  weightEstimateGb,
  pooledVramGb,
  fit,
  onOpenModelCard,
}: {
  model: HuggingFaceModel;
  isLocal: boolean;
  activeDownload: ModelDownload | null;
  isStarting: boolean;
  onStartDownload: (id: string) => void;
  onPauseDownload: (id: string) => void;
  onResumeDownload: (id: string) => void;
  variantCount: number;
  expanded: boolean;
  onToggleExpand?: () => void;
  child?: boolean;
  /** When set (e.g. grouped explore row), overrides per-variant HF stats. */
  displayDownloads?: number;
  displayLikes?: number;
  weightEstimateGb?: number | null;
  pooledVramGb: number;
  fit?: ModelFit;
  onOpenModelCard?: () => void;
}) {
  const provider = useMemo(() => extractProvider(model.modelId), [model.modelId]);
  const quants = useMemo(() => extractQuantizations(model.tags), [model.tags]);
  const [copied, setCopied] = useState(false);

  const copyId = useCallback(() => {
    navigator.clipboard.writeText(model.modelId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [model.modelId]);

  const download = downloadStatus(isLocal, isStarting, activeDownload);

  return (
    <ModelRow
      label={rowLabel(model.modelId, child)}
      description={rowDescription(provider, variantCount, child)}
      onClick={onOpenModelCard}
      highlight={
        fit && !child && (fit.status === "best" || fit.status === "fits") ? "success" : "none"
      }
      value={
        <div className="flex min-w-0 items-center gap-3">
          <ModelLogo modelId={model.modelId} author={model.author} size={child ? "sm" : "md"} />
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[length:var(--fs-md)] text-(--dim)">
              <span className="font-mono text-(--fg)">
                {quants.length ? quants.join(", ") : child ? "derivative" : "original"}
              </span>
              <ExploreVramCell needGb={weightEstimateGb ?? null} poolGb={pooledVramGb} fit={fit} />
              <span>{formatNumber(displayDownloads ?? model.downloads)} downloads</span>
              <span>{formatNumber(displayLikes ?? model.likes)} likes</span>
            </div>
          </div>
        </div>
      }
      status={
        <div className="flex flex-col items-end gap-0.5">
          <ModelStatus tone={download.tone}>{download.label}</ModelStatus>
        </div>
      }
      actions={
        <ExploreModelActions
          modelId={model.modelId}
          activeDownload={activeDownload}
          isLocal={isLocal}
          isStarting={isStarting}
          copied={copied}
          expanded={expanded}
          expandable={variantCount > 1 && !child && Boolean(onToggleExpand)}
          onCopy={copyId}
          onToggleExpand={onToggleExpand}
          onStartDownload={onStartDownload}
          onPauseDownload={onPauseDownload}
          onResumeDownload={onResumeDownload}
        />
      }
    >
      {activeDownload ? (
        <div
          className="text-[length:var(--fs-sm)] text-(--dim)"
          title={`Server path: ${activeDownload.target_dir}`}
        >
          {formatBytes(activeDownload.downloaded_bytes)} / {formatBytes(activeDownload.total_bytes)}{" "}
          · {activeDownload.target_dir}
        </div>
      ) : null}
    </ModelRow>
  );
});

function ExploreModelActions({
  modelId,
  activeDownload,
  isLocal,
  isStarting,
  copied,
  expanded,
  expandable,
  onCopy,
  onToggleExpand,
  onStartDownload,
  onPauseDownload,
  onResumeDownload,
}: {
  modelId: string;
  activeDownload: ModelDownload | null;
  isLocal: boolean;
  isStarting: boolean;
  copied: boolean;
  expanded: boolean;
  expandable: boolean;
  onCopy: () => void;
  onToggleExpand?: () => void;
  onStartDownload: (id: string) => void;
  onPauseDownload: (id: string) => void;
  onResumeDownload: (id: string) => void;
}) {
  return (
    <>
      {expandable && onToggleExpand ? (
        <ModelButton onClick={onToggleExpand} title={expanded ? "Hide variants" : "Show variants"}>
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </ModelButton>
      ) : null}
      <ModelButton onClick={onCopy} title="Copy model id">
        {copied ? <Check className="h-3 w-3 text-(--hl2)" /> : <Copy className="h-3 w-3" />}
      </ModelButton>
      <DownloadAction
        modelId={modelId}
        activeDownload={activeDownload}
        isLocal={isLocal}
        isStarting={isStarting}
        onStartDownload={onStartDownload}
        onPauseDownload={onPauseDownload}
        onResumeDownload={onResumeDownload}
      />
      <a
        href={`https://huggingface.co/${modelId}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex h-7 items-center justify-center rounded-md px-2 text-[length:var(--fs-sm)] text-(--dim) transition-colors hover:bg-(--hover) hover:text-(--fg)"
        title="Open on Hugging Face"
      >
        <ExternalLink className="h-3 w-3" />
      </a>
    </>
  );
}

function DownloadAction({
  modelId,
  activeDownload,
  isLocal,
  isStarting,
  onStartDownload,
  onPauseDownload,
  onResumeDownload,
}: {
  modelId: string;
  activeDownload: ModelDownload | null;
  isLocal: boolean;
  isStarting: boolean;
  onStartDownload: (id: string) => void;
  onPauseDownload: (id: string) => void;
  onResumeDownload: (id: string) => void;
}) {
  if (activeDownload?.status === "downloading") {
    return (
      <ModelButton onClick={() => onPauseDownload(activeDownload.id)} title="Pause server download">
        <Pause className="h-3 w-3" />
      </ModelButton>
    );
  }
  if (activeDownload?.status === "paused" || activeDownload?.status === "failed") {
    return (
      <ModelButton
        onClick={() => onResumeDownload(activeDownload.id)}
        title="Resume server download"
      >
        <Play className="h-3 w-3" />
      </ModelButton>
    );
  }
  if (isLocal) return null;
  return (
    <ModelButton onClick={() => onStartDownload(modelId)} disabled={isStarting} tone="primary">
      <DownloadCloud className="h-3 w-3" />
      Download
    </ModelButton>
  );
}

function downloadStatus(
  isLocal: boolean,
  isStarting: boolean,
  activeDownload: ModelDownload | null,
): { tone: ModelStatusTone; label: string } {
  if (isLocal) return { tone: "good", label: "local" };
  if (isStarting) return { tone: "info", label: "starting" };
  if (activeDownload?.status === "failed") return { tone: "danger", label: activeDownload.status };
  if (activeDownload) return { tone: "info", label: activeDownload.status };
  return { tone: "default", label: "remote" };
}

function rowLabel(modelId: string, child?: boolean) {
  return child ? modelId.split("/").pop() || modelId : modelId;
}

function rowDescription(provider: string, variantCount: number, child?: boolean) {
  return `${provider}${variantCount > 1 && !child ? ` · ${variantCount - 1} quantized variants` : ""}`;
}
