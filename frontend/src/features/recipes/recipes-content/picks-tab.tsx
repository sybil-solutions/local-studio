"use client";

import { useCallback, useMemo, useState } from "react";
import { Brain, ChevronRight, DownloadCloud, Eye, RefreshCw, Zap } from "@/ui/icon-registry";
import { Card } from "@/ui";
import { cx } from "@/ui/utils";
import api from "@/lib/api/client";
import type {
  ModelIndexModel,
  ModelIndexResponse,
  ModelIndexTier,
  ModelIndexVariant,
  ModelIndexVariantFormat,
} from "@/lib/api/studio";
import type { GPU, ModelDownload } from "@/lib/types";
import { useDownloads } from "@/hooks/use-downloads";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { ModelButton, ModelStatus } from "./model-page";
import { downloadProgressText } from "./downloads-tab";
import { sumGpuMemoryPoolGb } from "./explore-eligibility";
import { readExplorePoolOverrideGb } from "./explore-pool-storage";
import { buildHardwareProfile } from "./hardware-profile";

const FORMAT_ORDER: ModelIndexVariantFormat[] = ["bf16", "fp8", "nvfp4", "q4"];

const FORMAT_LABELS: Record<ModelIndexVariantFormat, string> = {
  bf16: "BF16",
  fp8: "FP8",
  nvfp4: "NVFP4",
  q4: "Q4",
};

function formatContextTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return "—";
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}K` : String(tokens);
}

function useModelIndex() {
  const [data, setData] = useState<ModelIndexResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await api.getModelIndex();
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the curated catalog");
    } finally {
      setLoading(false);
    }
  }, []);

  useMountSubscription(() => {
    void refresh();
  }, [refresh]);

  return { data, loading, error, refresh };
}

/**
 * Same VRAM-pool source as the Explore tab (see use-explore.ts): connected GPUs
 * via api.getGPUs(), the controller's max_vram_gb as fallback, and the user's
 * manual pool override from explore-pool-storage when set.
 */
function useHardwareProfile() {
  const [gpus, setGpus] = useState<GPU[]>([]);
  const [apiMaxVramGb, setApiMaxVramGb] = useState(0);
  const [poolOverrideGb, setPoolOverrideGb] = useState<number | null>(null);

  useMountSubscription(() => {
    setPoolOverrideGb(readExplorePoolOverrideGb());
  }, []);

  useMountSubscription(() => {
    void (async () => {
      const [recData, gpuData] = await Promise.all([
        api.getModelRecommendations().catch(() => null),
        api.getGPUs().catch(() => ({ gpus: [] as GPU[] })),
      ]);
      setApiMaxVramGb(typeof recData?.max_vram_gb === "number" ? recData.max_vram_gb : 0);
      setGpus(gpuData.gpus ?? []);
    })();
  }, []);

  return useMemo(() => {
    const poolGbFromGpus = sumGpuMemoryPoolGb(gpus);
    const detectedPoolGb = poolGbFromGpus > 0 ? poolGbFromGpus : apiMaxVramGb;
    const poolGb =
      poolOverrideGb != null && poolOverrideGb > 0
        ? poolOverrideGb
        : detectedPoolGb > 0
          ? detectedPoolGb
          : 0;
    return buildHardwareProfile({ gpus, poolGb, detectedPoolGb, poolOverrideGb });
  }, [gpus, apiMaxVramGb, poolOverrideGb]);
}

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
      }).catch(() => {
        // startDownload already surfaces the message through useDownloads' error state.
      });
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

function TierSection({
  tier,
  poolGb,
  downloadsByModel,
  startingModelIds,
  onDownload,
}: {
  tier: ModelIndexTier;
  poolGb: number;
  downloadsByModel: Map<string, ModelDownload>;
  startingModelIds: Set<string>;
  onDownload: (variant: ModelIndexVariant) => void;
}) {
  return (
    <details className="group" open>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 border-b border-(--ui-border)/75 pb-2">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <ChevronRight className="h-3.5 w-3.5 shrink-0 self-center text-(--ui-muted) transition-transform group-open:rotate-90" />
          <h3 className="text-[length:var(--fs-md)] font-medium text-(--ui-fg)">{tier.label}</h3>
          <span className="truncate text-[length:var(--fs-sm)] text-(--ui-muted)">
            {tier.blurb}
          </span>
        </div>
        <span className="shrink-0 text-[length:var(--fs-xs)] text-(--ui-muted)">
          {tier.models.length} {tier.models.length === 1 ? "model" : "models"}
        </span>
      </summary>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {tier.models.map((model) => (
          <PickCard
            key={model.id}
            model={model}
            poolGb={poolGb}
            downloadsByModel={downloadsByModel}
            startingModelIds={startingModelIds}
            onDownload={onDownload}
          />
        ))}
      </div>
    </details>
  );
}

function PickCard({
  model,
  poolGb,
  downloadsByModel,
  startingModelIds,
  onDownload,
}: {
  model: ModelIndexModel;
  poolGb: number;
  downloadsByModel: Map<string, ModelDownload>;
  startingModelIds: Set<string>;
  onDownload: (variant: ModelIndexVariant) => void;
}) {
  const variantGroups = FORMAT_ORDER.map((format) => ({
    format,
    entries: model.variants.filter((variant) => variant.format === format),
  })).filter((group) => group.entries.length > 0);

  return (
    <Card padding="md" className="flex flex-col">
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate text-[length:var(--fs-md)] font-medium text-(--ui-fg)">
          {model.name}
        </span>
        {model.role ? (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-md bg-(--ui-hover)/60 px-1.5 py-0.5 text-[length:var(--fs-xs)] font-medium text-(--ui-muted)"
            title={model.role === "fast" ? "Tuned for speed" : "Tuned for quality"}
          >
            {model.role === "fast" ? <Zap className="h-3 w-3" /> : <Brain className="h-3 w-3" />}
            {model.role}
          </span>
        ) : null}
        {model.multimodal ? (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-md bg-(--ui-hover)/60 px-1.5 py-0.5 text-[length:var(--fs-xs)] font-medium text-(--ui-muted)"
            title="Accepts image input"
          >
            <Eye className="h-3 w-3" />
            multimodal
          </span>
        ) : null}
      </div>

      <p className="mt-1 text-[length:var(--fs-sm)] text-(--ui-muted)">{model.description}</p>

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[length:var(--fs-xs)] text-(--ui-muted)">
        <span title={model.params}>
          {model.params}
          {model.active_params_b != null ? ` · ${model.active_params_b} B active` : ""}
        </span>
        <span className="shrink-0">{formatContextTokens(model.context_tokens)} ctx</span>
        <span className="shrink-0">{model.license}</span>
      </div>

      {variantGroups.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-start gap-2">
          {variantGroups.map((group) => (
            <VariantGroup
              key={group.format}
              format={group.format}
              entries={group.entries}
              poolGb={poolGb}
              downloadsByModel={downloadsByModel}
              startingModelIds={startingModelIds}
              onDownload={onDownload}
            />
          ))}
        </div>
      ) : (
        <div className="mt-3 text-[length:var(--fs-sm)] text-(--ui-muted)">
          No downloadable variants published yet.
        </div>
      )}

      {model.notes.length > 0 ? (
        <details className="group/notes mt-3 border-t border-(--ui-border)/55 pt-2">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[length:var(--fs-xs)] font-medium text-(--ui-muted) transition-colors hover:text-(--ui-fg)">
            <ChevronRight className="h-3 w-3 transition-transform group-open/notes:rotate-90" />
            Serving notes ({model.notes.length})
          </summary>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[length:var(--fs-xs)] leading-relaxed text-(--ui-muted)">
            {model.notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </Card>
  );
}

function VariantGroup({
  format,
  entries,
  poolGb,
  downloadsByModel,
  startingModelIds,
  onDownload,
}: {
  format: ModelIndexVariantFormat;
  entries: ModelIndexVariant[];
  poolGb: number;
  downloadsByModel: Map<string, ModelDownload>;
  startingModelIds: Set<string>;
  onDownload: (variant: ModelIndexVariant) => void;
}) {
  const [main, ...alts] = entries;
  return (
    <div className="flex flex-col gap-1">
      <VariantButton
        format={format}
        variant={main}
        poolGb={poolGb}
        download={downloadsByModel.get(main.repo) ?? null}
        isStarting={startingModelIds.has(main.repo)}
        onDownload={onDownload}
      />
      {alts.map((alt) => (
        <VariantButton
          key={alt.repo}
          format={format}
          variant={alt}
          alt
          poolGb={poolGb}
          download={downloadsByModel.get(alt.repo) ?? null}
          isStarting={startingModelIds.has(alt.repo)}
          onDownload={onDownload}
        />
      ))}
    </div>
  );
}

function VariantButton({
  format,
  variant,
  alt = false,
  poolGb,
  download,
  isStarting,
  onDownload,
}: {
  format: ModelIndexVariantFormat;
  variant: ModelIndexVariant;
  alt?: boolean;
  poolGb: number;
  download: ModelDownload | null;
  isStarting: boolean;
  onDownload: (variant: ModelIndexVariant) => void;
}) {
  const busy = isStarting || download?.status === "downloading" || download?.status === "paused";
  const titleLines = [
    variant.repo,
    variant.caveat ? `Caveat: ${variant.caveat}` : null,
    download ? `Status: ${download.status}` : null,
  ].filter(Boolean);
  const sourceLabel = !variant.official
    ? (variant.source ?? variant.repo.split("/")[0] ?? null)
    : null;

  return (
    <div className="flex flex-col gap-0.5">
      <button
        type="button"
        disabled={busy}
        onClick={() => onDownload(variant)}
        title={titleLines.join("\n")}
        className={cx(
          "inline-flex items-center gap-1.5 rounded-md border border-(--ui-border) font-medium transition-[background-color,color,transform] active:translate-y-px disabled:pointer-events-none disabled:opacity-45",
          alt
            ? "px-1.5 py-0.5 text-[length:var(--fs-xs)] text-(--ui-muted) hover:bg-(--ui-hover) hover:text-(--ui-fg)"
            : "bg-(--ui-surface) px-2 py-1 text-[length:var(--fs-sm)] text-(--ui-fg) hover:bg-(--ui-hover)",
        )}
      >
        <DownloadCloud className="h-3 w-3" />
        {alt
          ? `${FORMAT_LABELS[format]} alt${sourceLabel ? ` · ${sourceLabel}` : ""}`
          : FORMAT_LABELS[format]}
      </button>
      {!alt && (variant.size_gb != null || sourceLabel) ? (
        <span className="px-0.5 font-mono text-[length:var(--fs-xs)] text-(--ui-muted)">
          {variant.size_gb != null ? `${variant.size_gb} GB` : "size n/a"}
          {sourceLabel ? ` · ${sourceLabel}` : ""}
        </span>
      ) : null}
      <VariantFitBadge sizeGb={variant.size_gb} poolGb={poolGb} />
      {variant.caveat ? (
        <span
          className="px-0.5 text-[length:var(--fs-xs)] text-(--ui-muted)/80"
          title={variant.caveat}
        >
          {variant.caveat}
        </span>
      ) : null}
      <VariantDownloadState download={download} isStarting={isStarting} />
    </div>
  );
}

/**
 * Explore-tab idiom (see ExploreVramCell in explore-model-row.tsx): green
 * "fits" with pool share when within the VRAM pool, red "needs ~N GB" when
 * over. Catalog sizes are approximate, so this stays a binary fits/over badge.
 * Renders nothing when the size or the pool is unknown.
 */
function VariantFitBadge({ sizeGb, poolGb }: { sizeGb: number | null; poolGb: number }) {
  if (sizeGb == null || !Number.isFinite(sizeGb) || poolGb <= 0) return null;
  const over = sizeGb > poolGb;
  const poolPercent = Math.round((sizeGb / poolGb) * 100);
  return (
    <span
      className={cx(
        "px-0.5 font-mono text-[length:var(--fs-xs)]",
        over ? "text-(--err)" : "text-(--hl2)",
      )}
      title={`Approximate weights size vs ${Math.round(poolGb)} GB pooled GPU VRAM`}
    >
      {over ? `needs ~${sizeGb} GB` : "fits"} · {poolPercent}% pool
    </span>
  );
}

function VariantDownloadState({
  download,
  isStarting,
}: {
  download: ModelDownload | null;
  isStarting: boolean;
}) {
  if (isStarting) {
    return <span className="px-0.5 text-[length:var(--fs-xs)] text-(--ui-info)">starting…</span>;
  }
  if (!download) return null;
  if (download.status === "downloading" || download.status === "paused") {
    return (
      <span className="px-0.5 text-[length:var(--fs-xs)] text-(--ui-info)">
        {downloadProgressText(download)}
      </span>
    );
  }
  if (download.status === "failed") {
    return (
      <span className="px-0.5 text-[length:var(--fs-xs)] text-(--err)">
        failed{download.error ? ` — ${download.error}` : ""}
      </span>
    );
  }
  if (download.status === "completed") {
    return <span className="px-0.5 text-[length:var(--fs-xs)] text-(--hl2)">downloaded</span>;
  }
  return null;
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
