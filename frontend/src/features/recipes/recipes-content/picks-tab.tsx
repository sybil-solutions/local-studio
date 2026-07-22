"use client";

import { useCallback } from "react";
import { RefreshCw } from "@/ui/icon-registry";
import { Card } from "@/ui";
import { cx } from "@/ui/utils";
import type { ModelIndexVariant } from "@/lib/api/studio";
import { useDownloads } from "@/hooks/use-downloads";
import { ModelButton, ModelStatus } from "./model-page";
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
    <div className="space-y-5">
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
    <div className="grid gap-4 md:grid-cols-2">
      {Array.from({ length: 4 }, (_, index) => (
        <Card key={index} padding="md">
          <div className="h-4 w-2/5 animate-pulse rounded bg-(--ui-hover)" />
          <div className="mt-2 h-3 w-4/5 animate-pulse rounded bg-(--ui-hover)/70" />
          <div className="mt-2 h-2.5 w-3/5 animate-pulse rounded bg-(--ui-hover)/70" />
          <div className="mt-3 flex gap-2">
            <div className="h-7 w-16 animate-pulse rounded-md bg-(--ui-hover)/70" />
            <div className="h-7 w-16 animate-pulse rounded-md bg-(--ui-hover)/70" />
            <div className="h-7 w-16 animate-pulse rounded-md bg-(--ui-hover)/70" />
          </div>
        </Card>
      ))}
    </div>
  );
}

function PicksErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <Card padding="lg" className="text-center">
      <div className="text-[length:var(--fs-md)] font-medium text-(--ui-fg)">
        The curated catalog could not be loaded
      </div>
      <p className="mt-1 text-[length:var(--fs-sm)] text-(--ui-muted)">{error}</p>
      <div className="mt-3 flex justify-center">
        <ModelButton tone="primary" onClick={onRetry}>
          <RefreshCw className="h-3 w-3" />
          Try again
        </ModelButton>
      </div>
    </Card>
  );
}

function PicksEmptyState() {
  return (
    <Card padding="lg" className="text-center">
      <div className="text-[length:var(--fs-md)] font-medium text-(--ui-fg)">
        No curated picks yet
      </div>
      <p className="mt-1 text-[length:var(--fs-sm)] text-(--ui-muted)">
        The catalog returned zero tiers. Refresh to query the controller again, or browse the Get
        tab in the meantime.
      </p>
    </Card>
  );
}
