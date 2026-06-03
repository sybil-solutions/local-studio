"use client";

import { memo, useMemo } from "react";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  DownloadCloud,
  ExternalLink,
  Heart,
  Pause,
  Play,
} from "lucide-react";
import { Button, ModelLogo, StatusPill, TCell, TRow } from "@/ui";
import type { HuggingFaceModel, ModelDownload } from "@/lib/types";
import { formatNumber } from "@/lib/formatters";
import { resolveModelRowView, type ModelRowDownloadAction } from "./model-row-model";

interface ModelRowProps {
  model: HuggingFaceModel;
  copied: boolean;
  isLocal: boolean;
  activeDownload: ModelDownload | null;
  isStarting: boolean;
  onCopyModelId: (modelId: string) => void;
  onStartDownload: (params: { model_id: string }) => Promise<void>;
  onPauseDownload: (downloadId: string) => Promise<void>;
  onResumeDownload: (downloadId: string) => Promise<void>;
  variantCount?: number;
  expanded?: boolean;
  onToggleExpand?: () => void;
  child?: boolean;
  onOpenModelCard?: () => void;
}

export const ModelRow = memo(function ModelRow({
  model,
  copied,
  isLocal,
  activeDownload,
  isStarting,
  onCopyModelId,
  onStartDownload,
  onPauseDownload,
  onResumeDownload,
  variantCount = 1,
  expanded = false,
  onToggleExpand,
  child = false,
  onOpenModelCard,
}: ModelRowProps) {
  const view = useMemo(
    () =>
      resolveModelRowView({
        activeDownload,
        child,
        isLocal,
        isStarting,
        model,
        variantCount,
      }),
    [activeDownload, child, isLocal, isStarting, model, variantCount],
  );

  return (
    <TRow
      className={view.rowClasses}
      onClick={onOpenModelCard}
      interactive={Boolean(onOpenModelCard)}
    >
      <TCell className="px-4 py-3">
        <div className={`flex items-center gap-2 ${child ? "pl-5" : ""}`}>
          {view.hasVariants && !child && (
            <Button
              variant="icon"
              size="sm"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onToggleExpand?.();
              }}
              className="shrink-0"
              title={expanded ? "Collapse variants" : "Expand variants"}
            >
              {expanded ? (
                <ChevronDown className="h-3.5 w-3.5 text-(--dim)" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-(--dim)" />
              )}
            </Button>
          )}
          <ModelLogo modelId={model.modelId} author={model.author} size="sm" />
          <div className="text-sm font-medium text-(--fg) truncate max-w-xs" title={model.modelId}>
            {model.modelId}
          </div>
          <Button
            variant="icon"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              onCopyModelId(model.modelId);
            }}
            className="shrink-0"
            title="Copy model ID"
          >
            {copied ? (
              <Check className="h-3 w-3 text-(--hl2)" />
            ) : (
              <Copy className="h-3 w-3 text-(--dim)" />
            )}
          </Button>
        </div>
        {view.variantLabel && (
          <div className="text-[length:var(--fs-sm)] text-(--dim) mt-1 pl-7">
            {view.variantLabel}
          </div>
        )}
      </TCell>
      <TCell className="px-4 py-3">
        <StatusPill tone="default" variant="badge">
          {view.provider}
        </StatusPill>
      </TCell>
      <TCell className="px-4 py-3">
        {model.pipeline_tag ? (
          <StatusPill tone="default" variant="badge">
            {model.pipeline_tag}
          </StatusPill>
        ) : (
          <span className="text-xs text-(--dim)">—</span>
        )}
      </TCell>
      <TCell className="px-4 py-3">
        <div className="flex flex-wrap gap-1">{renderQuantizations(view.quantizations)}</div>
      </TCell>
      <TCell className="px-4 py-3">
        {isLocal ? (
          <StatusPill tone="good" variant="badge">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Local
          </StatusPill>
        ) : (
          <span className="text-xs text-(--dim)">—</span>
        )}
      </TCell>
      <TCell align="right" className="px-4 py-3">
        <div className="flex items-center justify-end gap-4 text-xs text-(--dim)">
          <div className="flex items-center gap-1" title="Downloads">
            <Download className="h-3.5 w-3.5" />
            <span>{formatNumber(model.downloads)}</span>
          </div>
          <div className="flex items-center gap-1" title="Likes">
            <Heart className="h-3.5 w-3.5" />
            <span>{formatNumber(model.likes)}</span>
          </div>
        </div>
      </TCell>
      <TCell align="right" className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
        <a
          href={view.modelUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block rounded p-1.5 text-(--ui-info) transition-colors hover:bg-(--ui-hover)"
          title="View on Hugging Face"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
      </TCell>
      <TCell align="right" className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
        <DownloadAction
          action={view.downloadAction}
          onPauseDownload={onPauseDownload}
          onResumeDownload={onResumeDownload}
          onStartDownload={onStartDownload}
        />
      </TCell>
    </TRow>
  );
});

function renderQuantizations(quantizations: string[]) {
  if (quantizations.length === 0) {
    return <span className="text-xs text-(--dim)">—</span>;
  }
  return quantizations.map((quantization) => (
    <StatusPill tone="warning" variant="badge" key={quantization}>
      {quantization}
    </StatusPill>
  ));
}

function DownloadAction({
  action,
  onPauseDownload,
  onResumeDownload,
  onStartDownload,
}: {
  action: ModelRowDownloadAction;
  onPauseDownload: (downloadId: string) => Promise<void>;
  onResumeDownload: (downloadId: string) => Promise<void>;
  onStartDownload: (params: { model_id: string }) => Promise<void>;
}) {
  if (action.kind === "ready") {
    return (
      <StatusPill tone="good" variant="badge">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Ready
      </StatusPill>
    );
  }
  if (action.kind === "starting") {
    return (
      <StatusPill tone="default" variant="badge">
        Starting...
      </StatusPill>
    );
  }
  if (action.kind === "download") {
    return (
      <Button
        size="sm"
        onClick={() => onStartDownload({ model_id: action.modelId })}
        icon={<DownloadCloud className="h-3.5 w-3.5" />}
      >
        Download
      </Button>
    );
  }
  return (
    <div className="flex items-center justify-end gap-2">
      {action.canPause && (
        <Button
          variant="icon"
          size="sm"
          onClick={() => onPauseDownload(action.downloadId)}
          title="Pause download"
        >
          <Pause className="h-4 w-4" />
        </Button>
      )}
      {action.canResume && (
        <Button
          variant="icon"
          size="sm"
          onClick={() => onResumeDownload(action.downloadId)}
          title="Resume download"
        >
          <Play className="h-4 w-4" />
        </Button>
      )}
      {action.label && (
        <span
          className={`text-xs ${action.label === "Downloaded" ? "text-(--hl2)" : "text-(--dim)"}`}
        >
          {action.label}
        </span>
      )}
    </div>
  );
}
