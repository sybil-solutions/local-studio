"use client";

import { useCallback } from "react";
import { RefreshCw } from "@/ui/icon-registry";
import { ModelButton } from "@/ui";
import { cx } from "@/ui/utils";
import type { ModelIndexVariant } from "@/lib/api/studio";
import { useDownloads } from "@/features/recipes/use-downloads";
import { TableNotice, TableSkeleton } from "./catalog-table-shell";
import { CatalogContextLine } from "./catalog-context-line";
import { FIT_BUDGET_RATIO, formatGb } from "./model-fit";
import { PicksCatalog, useHardwareProfile, useModelIndex } from "./picks-shared";

export function PicksTab() {
  const { data, loading, error, refresh } = useModelIndex();
  const hardware = useHardwareProfile();
  const {
    downloadsByModel,
    startingModelIds,
    error: downloadError,
    startDownload,
  } = useDownloads();

  const handleDownload = useCallback(
    (variant: ModelIndexVariant) => {
      void startDownload({
        model_id: variant.repo,
        ...(variant.allow_patterns?.length ? { allow_patterns: variant.allow_patterns } : {}),
      }).catch(() => {});
    },
    [startDownload],
  );

  const tiers = data?.tiers ?? [];
  const poolLabel =
    hardware.poolGb > 0 ? `${Math.round(hardware.poolGb)} GB pool` : "No GPUs detected";
  const poolDetail =
    hardware.poolGb > 0
      ? `${hardware.label} — under ${formatGb(hardware.poolGb * FIT_BUDGET_RATIO)} (${Math.round(FIT_BUDGET_RATIO * 100)}%)`
      : "Connect the controller to check hardware fit.";

  return (
    <div className="space-y-4">
      <CatalogContextLine
        primary={poolLabel}
        secondary={poolDetail}
        meta={data?.updated ? `updated ${data.updated}` : undefined}
        actions={
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            title="Reload catalog"
            aria-label="Reload catalog"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-(--ui-muted) transition-colors hover:bg-(--ui-hover) hover:text-(--ui-fg) disabled:opacity-45"
          >
            <RefreshCw className={cx("h-3.5 w-3.5", loading ? "animate-spin" : "")} />
          </button>
        }
      />

      {downloadError ? (
        <div className="text-[length:var(--fs-sm)] text-(--err)">{downloadError}</div>
      ) : null}

      {loading && tiers.length === 0 ? (
        <PicksLoadingGrid />
      ) : error && tiers.length === 0 ? (
        <PicksErrorState error={error} onRetry={() => void refresh()} />
      ) : tiers.length === 0 ? (
        <PicksEmptyState />
      ) : (
        <PicksCatalog
          tiers={tiers}
          poolGb={hardware.poolGb}
          downloadsByModel={downloadsByModel}
          startingModelIds={startingModelIds}
          onDownload={handleDownload}
        />
      )}

      {data?.intelligence_source ? (
        <p className="text-[length:var(--fs-xs)] text-(--ui-muted)/70">
          Index — {data.intelligence_source}.
        </p>
      ) : null}
    </div>
  );
}

const PICKS_COLUMNS = ["Model", "Index", "Params", "Context", "Memory", "Status"] as const;

function PicksLoadingGrid() {
  return <TableSkeleton columns={PICKS_COLUMNS} />;
}

function PicksErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <TableNotice
      title="The catalog did not load"
      body={`${error} — check that the controller is reachable, then try again.`}
      action={
        <ModelButton tone="primary" onClick={onRetry}>
          <RefreshCw className="h-3 w-3" />
          Try again
        </ModelButton>
      }
    />
  );
}

function PicksEmptyState() {
  return (
    <TableNotice
      title="No curated picks"
      body="The catalog returned zero hardware tiers. Reload it, or use Hugging Face to find weights yourself."
    />
  );
}
