import { memo, useMemo } from "react";
import { ChevronDown, ChevronRight, DownloadCloud, Pause, Play } from "@/ui/icon-registry";
import type { HuggingFaceModel, ModelDownload } from "@/lib/types";
import { formatNumber } from "@/lib/formatters";
import { ModelLogo } from "@/ui/model-logo";
import { cx } from "@/ui/utils";
import { extractProvider } from "@/lib/huggingface";
import { extractQuantizations } from "@/features/recipes/model-quantizations";
import type { ModelFit } from "./hardware-profile";
import { DataRow, EndCell, LeadCell, NumCell, RowAction, StatusText } from "./catalog-table-shell";
import { downloadProgressText } from "./downloads-tab";
import { FIT_BUDGET_RATIO } from "./model-fit";

/**
 * A Hugging Face search hit, drawn on the catalog's table.
 *
 * The columns answer the same questions Recommended answers, sourced from what
 * the Hub actually knows: who else uses this (downloads), what precision you
 * can get it in, what it costs in memory, and whether you already have it. A
 * repo too large for the pool is dimmed rather than reddened.
 */
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
  const needGb = weightEstimateGb ?? null;
  const over = needGb != null && pooledVramGb > 0 && needGb > pooledVramGb;
  const expandable = variantCount > 1 && !child && Boolean(onToggleExpand);

  return (
    <DataRow
      onOpen={onOpenModelCard ? () => onOpenModelCard(model, variants, fit) : undefined}
      ariaLabel={`Open ${model.modelId} details`}
      dimmed={over}
    >
      <ExploreLead
        model={model}
        provider={provider}
        variantCount={variantCount}
        expanded={expanded}
        expandable={expandable}
        onToggleExpand={onToggleExpand}
        child={child}
      />

      <NumCell strong={!child} sub={model.likes ? `${formatNumber(model.likes)} likes` : undefined}>
        {formatNumber(model.downloads)}
      </NumCell>

      <NumCell>
        {quants.length ? (
          <span className="text-(--dim)">{quants.slice(0, 2).join(" · ")}</span>
        ) : (
          "—"
        )}
      </NumCell>

      <NumCell
        sub={<PoolShare needGb={needGb} poolGb={pooledVramGb} />}
        title={fit?.reason ?? "Estimated weight footprint against the pooled GPU memory"}
      >
        <span className="text-(--fg)">{needGb == null ? "—" : `~${formatNeed(needGb)} GB`}</span>
      </NumCell>

      <EndCell>
        <ExploreStatusCell
          modelId={model.modelId}
          isLocal={isLocal}
          isStarting={isStarting}
          activeDownload={activeDownload}
          onStartDownload={onStartDownload}
          onPauseDownload={onPauseDownload}
          onResumeDownload={onResumeDownload}
        />
      </EndCell>
    </DataRow>
  );
});

/** Identity cell: disclosure, logo, repo id, and who published it. */
function ExploreLead({
  model,
  provider,
  variantCount,
  expanded,
  expandable,
  onToggleExpand,
  child,
}: {
  model: HuggingFaceModel;
  provider: string;
  variantCount: number;
  expanded: boolean;
  expandable: boolean;
  onToggleExpand?: () => void;
  child?: boolean;
}) {
  return (
    <LeadCell>
      <div className={cx("flex min-w-0 items-center gap-2.5", child ? "pl-6" : "")}>
        {expandable ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggleExpand?.();
            }}
            title={expanded ? "Hide variants" : `Show ${variantCount - 1} quantized variants`}
            aria-label={expanded ? "Hide variants" : "Show variants"}
            className="-ml-1.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-(--dim) transition-colors hover:text-(--fg)"
          >
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        ) : child ? null : (
          // Families without variants still reserve the chevron's width, so
          // every top-level name starts on the same left edge.
          <span aria-hidden className="-ml-1.5 h-5 w-5 shrink-0" />
        )}
        <ModelLogo modelId={model.modelId} author={model.author} size="sm" className="rounded-md" />
        <div className="min-w-0">
          <div
            className="truncate text-[length:var(--fs-md)] font-medium text-(--fg)"
            title={model.modelId}
          >
            {child ? (model.modelId.split("/").pop() ?? model.modelId) : model.modelId}
          </div>
          <div className="truncate text-[length:var(--fs-xs)] text-(--dim)/60">
            {provider}
            {variantCount > 1 && !child ? ` · ${variantCount - 1} variants` : ""}
          </div>
        </div>
      </div>
    </LeadCell>
  );
}

function formatNeed(needGb: number): string {
  return needGb < 10 ? needGb.toFixed(1) : Math.round(needGb).toString();
}

function PoolShare({ needGb, poolGb }: { needGb: number | null; poolGb: number }) {
  if (needGb == null || poolGb <= 0) return <span>estimate</span>;
  if (needGb > poolGb * FIT_BUDGET_RATIO && needGb > poolGb) return <span>over pool</span>;
  const percent = Math.round((needGb / poolGb) * 100);
  return <span>{percent < 1 ? "<1% of pool" : `${percent}% of pool`}</span>;
}

function ExploreStatusCell({
  modelId,
  isLocal,
  isStarting,
  activeDownload,
  onStartDownload,
  onPauseDownload,
  onResumeDownload,
}: {
  modelId: string;
  isLocal: boolean;
  isStarting: boolean;
  activeDownload: ModelDownload | null;
  onStartDownload: (id: string) => void;
  onPauseDownload: (id: string) => void;
  onResumeDownload: (id: string) => void;
}) {
  if (activeDownload?.status === "downloading") {
    return (
      <div className="flex items-center justify-end gap-2">
        <StatusText>{downloadProgressText(activeDownload)}</StatusText>
        <RowAction onClick={() => onPauseDownload(activeDownload.id)} tone="quiet" title="Pause">
          <Pause className="h-3 w-3" />
        </RowAction>
      </div>
    );
  }
  if (activeDownload?.status === "paused" || activeDownload?.status === "failed") {
    const failed = activeDownload.status === "failed";
    return (
      <div className="flex items-center justify-end gap-2">
        <StatusText tone={failed ? "error" : "dim"}>{failed ? "failed" : "paused"}</StatusText>
        <RowAction onClick={() => onResumeDownload(activeDownload.id)} title="Resume">
          <Play className="h-3 w-3" />
          Retry
        </RowAction>
      </div>
    );
  }
  if (isLocal) return <StatusText>on disk</StatusText>;
  if (isStarting) return <StatusText>starting…</StatusText>;
  return (
    <RowAction onClick={() => onStartDownload(modelId)} title={`Download ${modelId}`}>
      <DownloadCloud className="h-3 w-3" />
      Download
    </RowAction>
  );
}
