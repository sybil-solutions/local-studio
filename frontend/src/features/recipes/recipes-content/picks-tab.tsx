"use client";

import { useCallback } from "react";
import { RefreshCw } from "@/ui/icon-registry";
import { ModelButton } from "@/ui";
import { cx } from "@/ui/utils";
import type { ModelIndexVariant } from "@/lib/api/studio";
import { useDownloads } from "@/hooks/use-downloads";
import { ModelRow, ModelSection, ModelStatus, ModelValue } from "./model-page";
import { TierSection, useHardwareProfile, useModelIndex } from "./picks-shared";

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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <ModelStatus
            tone={error ? "danger" : loading ? "info" : tiers.length ? "good" : "default"}
          >
            {error
              ? "error"
              : loading
                ? "loading"
                : tiers.length
                  ? `${tiers.length} tiers`
                  : "empty"}
          </ModelStatus>
          {data?.updated ? (
            <span className="text-[length:var(--fs-sm)] text-(--ui-muted)">
              Catalog updated {data.updated}
            </span>
          ) : null}
          {hardware.poolGb > 0 ? (
            <span className="text-[length:var(--fs-sm)] text-(--ui-muted)" title={hardware.detail}>
              {Math.round(hardware.poolGb)} GB pool · {hardware.label}
            </span>
          ) : null}
        </div>
        <ModelButton onClick={() => void refresh()} disabled={loading} title="Reload the catalog">
          <RefreshCw className={cx("h-3 w-3", loading ? "animate-spin" : "")} />
          Refresh
        </ModelButton>
      </div>

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
        tiers.map((tier) => (
          <TierSection
            key={tier.id}
            tier={tier}
            poolGb={hardware.poolGb}
            downloadsByModel={downloadsByModel}
            startingModelIds={startingModelIds}
            onDownload={handleDownload}
          />
        ))
      )}
    </div>
  );
}

function PicksLoadingGrid() {
  return (
    <ModelSection title="Curated catalog" description="Matching the catalog to this machine.">
      {Array.from({ length: 4 }, (_, index) => (
        <ModelRow
          key={index}
          label="Loading model"
          description="Checking hardware fit and available formats"
          variant="catalog"
          value={
            <div className="flex gap-2">
              <div className="h-7 w-16 animate-pulse rounded-md bg-(--ui-hover)" />
              <div className="h-7 w-20 animate-pulse rounded-md bg-(--ui-hover)/70" />
            </div>
          }
        />
      ))}
    </ModelSection>
  );
}

function PicksErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <ModelSection
      title="Curated catalog"
      description="The controller did not return the model catalog."
      actions={
        <ModelButton tone="primary" onClick={onRetry}>
          <RefreshCw className="h-3 w-3" />
          Try again
        </ModelButton>
      }
    >
      <ModelRow
        label="Catalog unavailable"
        description={error}
        value={<ModelValue dim>Check the controller connection and try again.</ModelValue>}
      />
    </ModelSection>
  );
}

function PicksEmptyState() {
  return (
    <ModelSection title="Curated catalog" description="No recommendations are available yet.">
      <ModelRow
        label="No curated picks"
        description="Refresh the controller catalog, or use Get to search for model weights."
        value={<ModelValue dim>The catalog returned zero hardware tiers.</ModelValue>}
      />
    </ModelSection>
  );
}
