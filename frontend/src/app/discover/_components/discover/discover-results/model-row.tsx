// CRITICAL
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
import type { HuggingFaceModel, ModelDownload } from "@/lib/types";
import { formatNumber } from "@/lib/formatters";
import { extractProvider, extractQuantizations } from "../../utils";

export const ModelRow = memo(function ModelRow({
  model,
  copied,
  isLocal,
  activeDownload,
  onCopyModelId,
  onStartDownload,
  onPauseDownload,
  onResumeDownload,
  variantCount = 1,
  expanded = false,
  onToggleExpand,
  child = false,
}: {
  model: HuggingFaceModel;
  copied: boolean;
  isLocal: boolean;
  activeDownload: ModelDownload | null;
  onCopyModelId: (modelId: string) => void;
  onStartDownload: (params: { model_id: string }) => Promise<void>;
  onPauseDownload: (downloadId: string) => Promise<void>;
  onResumeDownload: (downloadId: string) => Promise<void>;
  variantCount?: number;
  expanded?: boolean;
  onToggleExpand?: () => void;
  child?: boolean;
}) {
  const provider = useMemo(() => extractProvider(model.modelId), [model.modelId]);
  const quantizations = useMemo(() => extractQuantizations(model.tags), [model.tags]);
  const hasVariants = variantCount > 1;
  const rowClasses = child
    ? "bg-(--surface)/15 hover:bg-(--surface)/25 transition-colors"
    : "hover:bg-(--surface)/30 transition-colors";

  return (
    <tr className={rowClasses}>
      <td className="px-4 py-3">
        <div className={`flex items-center gap-2 ${child ? "pl-5" : ""}`}>
          {hasVariants && !child && (
            <button
              type="button"
              onClick={onToggleExpand}
              className="p-1 rounded hover:bg-(--surface) transition-colors shrink-0"
              title={expanded ? "Collapse variants" : "Expand variants"}
            >
              {expanded ? (
                <ChevronDown className="h-3.5 w-3.5 text-(--dim)" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-(--dim)" />
              )}
            </button>
          )}
          <div className="text-sm font-medium text-(--fg) truncate max-w-xs" title={model.modelId}>
            {model.modelId}
          </div>
          <button
            onClick={() => onCopyModelId(model.modelId)}
            className="p-1 hover:bg-(--surface) rounded transition-colors shrink-0"
            title="Copy model ID"
          >
            {copied ? <Check className="h-3 w-3 text-(--hl2)" /> : <Copy className="h-3 w-3 text-(--dim)" />}
          </button>
        </div>
        {!child && hasVariants && (
          <div className="text-[11px] text-(--dim) mt-1 pl-7">
            {variantCount} quantization variants
          </div>
        )}
      </td>
      <td className="px-4 py-3">
        <span className="px-2 py-1 bg-(--surface) border border-(--border) rounded text-xs text-(--fg)">{provider}</span>
      </td>
      <td className="px-4 py-3">
        {model.pipeline_tag ? (
          <span className="px-2 py-1 bg-(--surface) border border-(--border) rounded text-xs text-(--dim)">
            {model.pipeline_tag}
          </span>
        ) : (
          <span className="text-xs text-(--dim)">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {quantizations.length > 0 ? (
            quantizations.map((quantization) => (
              <span
                key={quantization}
                className="px-2 py-1 bg-(--hl3)/20 text-(--hl3) border border-(--hl3)/30 rounded text-xs font-medium"
              >
                {quantization}
              </span>
            ))
          ) : (
            <span className="text-xs text-(--dim)">—</span>
          )}
        </div>
      </td>
      <td className="px-4 py-3">
        {isLocal ? (
          <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-(--hl2)/20 text-(--hl2) border border-(--hl2)/30">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Local
          </span>
        ) : (
          <span className="text-xs text-(--dim)">—</span>
        )}
      </td>
      <td className="px-4 py-3 text-right">
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
      </td>
      <td className="px-4 py-3 text-right">
        <a
          href={`https://huggingface.co/${model.modelId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1.5 hover:bg-(--surface) rounded transition-colors inline-block text-(--hl1) hover:text-(--hl1)"
          title="View on Hugging Face"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
      </td>
      <td className="px-4 py-3 text-right">
        {isLocal ? (
          <span className="inline-flex items-center gap-1 text-xs text-(--hl2)">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Ready
          </span>
        ) : activeDownload ? (
          <div className="flex items-center justify-end gap-2">
            {activeDownload.status === "downloading" && (
              <button
                onClick={() => onPauseDownload(activeDownload.id)}
                className="p-1.5 rounded-lg border border-(--border) hover:bg-(--surface)"
                title="Pause download"
              >
                <Pause className="h-4 w-4" />
              </button>
            )}
            {(activeDownload.status === "paused" || activeDownload.status === "failed") && (
              <button
                onClick={() => onResumeDownload(activeDownload.id)}
                className="p-1.5 rounded-lg border border-(--border) hover:bg-(--surface)"
                title="Resume download"
              >
                <Play className="h-4 w-4" />
              </button>
            )}
            {activeDownload.status === "completed" && <span className="text-xs text-(--hl2)">Downloaded</span>}
            {(activeDownload.status === "downloading" || activeDownload.status === "queued") && (
              <span className="text-xs text-(--dim)">Downloading…</span>
            )}
          </div>
        ) : (
          <button
            onClick={() => onStartDownload({ model_id: model.modelId })}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-(--hl1) text-white text-xs font-medium hover:opacity-90"
          >
            <DownloadCloud className="h-3.5 w-3.5" />
            Download
          </button>
        )}
      </td>
    </tr>
  );
});
