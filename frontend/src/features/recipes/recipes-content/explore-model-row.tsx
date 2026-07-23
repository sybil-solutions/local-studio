import { memo, useCallback, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  DownloadCloud,
  ExternalLink,
  Pause,
  Play,
} from "@/ui/icon-registry";
import type { HuggingFaceModel, ModelDownload } from "@/lib/types";
import { formatBytes } from "@/lib/formatters";
import { ModelLogo } from "@/ui/model-logo";
import { ModelButton } from "@/ui";
import { ModelRow, ModelStatus, type ModelStatusTone } from "./model-page";
import { extractProvider } from "@/lib/huggingface";
import { extractQuantizations } from "@/features/recipes/model-quantizations";
import type { ModelFit } from "./hardware-profile";
import { effectTimeout } from "@/lib/effect-timers";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

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
        className="font-mono text-[length:var(--fs-sm)] tabular-nums text-(--dim)"
        title={fit?.reason ?? "Rough weight estimate from name and tags"}
      >
        ~{label} GB
      </span>
    );
  }
  const over = needGb > poolGb;
  const poolPercent = Math.round((needGb / poolGb) * 100);
  return (
    <span
      className="flex shrink-0 items-baseline gap-1.5 font-mono text-[length:var(--fs-sm)] tabular-nums"
      title={fit?.reason ?? "Estimated footprint vs pooled GPU VRAM"}
    >
      <span className={over ? "text-(--err)" : "text-(--fg)"}>~{label} GB</span>
      <span className={over ? "text-(--err)/80" : "text-(--dim)"}>{poolPercent}% pool</span>
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
  weightEstimateGb,
  pooledVramGb,
  fit,
  variants,
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
  weightEstimateGb?: number | null;
  pooledVramGb: number;
  fit?: ModelFit;
  variants: HuggingFaceModel[];
  onOpenModelCard?: (model: HuggingFaceModel, variants: HuggingFaceModel[], fit?: ModelFit) => void;
}) {
  const provider = useMemo(() => extractProvider(model.modelId), [model.modelId]);
  const quants = useMemo(() => extractQuantizations(model.tags), [model.tags]);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof effectTimeout> | null>(null);

  useMountSubscription(() => () => copiedTimer.current?.cancel(), []);

  const copyId = useCallback(() => {
    void navigator.clipboard.writeText(model.modelId);
    setCopied(true);
    copiedTimer.current?.cancel();
    copiedTimer.current = effectTimeout(() => setCopied(false), 2000);
  }, [model.modelId]);

  const download = downloadStatus(isLocal, isStarting, activeDownload);

  return (
    <ModelRow
      label={rowLabel(model.modelId, child)}
      description={rowDescription(provider, variantCount, child)}
      leading={
        <ModelLogo modelId={model.modelId} author={model.author} size={child ? "sm" : "md"} />
      }
      onClick={onOpenModelCard ? () => onOpenModelCard(model, variants, fit) : undefined}
      variant="catalog"
      className={child ? "md:pl-8" : undefined}
      value={
        <div className="flex min-w-0 items-center justify-end gap-3">
          {quants.length ? (
            <span className="min-w-0 truncate font-mono text-[length:var(--fs-xs)] uppercase tracking-[0.08em] text-(--ui-muted)">
              {quants.slice(0, 2).join(" · ")}
            </span>
          ) : null}
          <ExploreVramCell needGb={weightEstimateGb ?? null} poolGb={pooledVramGb} fit={fit} />
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
