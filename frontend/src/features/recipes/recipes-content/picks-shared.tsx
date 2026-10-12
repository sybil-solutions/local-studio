"use client";

import { useCallback, useMemo, useState } from "react";
import { DownloadCloud } from "@/ui/icon-registry";
import { ModelButton, StatusPill } from "@/ui";
import { ModelLogo } from "@/ui/model-logo";
import { ResourceDrawer, ResourceDrawerSection, ResourceFact } from "@/ui/resource-drawer";
import { cx } from "@/ui/utils";
import api from "@/lib/api/client";
import type {
  ModelIndexModel,
  ModelIndexResponse,
  ModelIndexTier,
  ModelIndexVariant,
} from "@/lib/api/studio";
import type { GPU, ModelDownload } from "@/lib/types";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { downloadProgressText } from "./downloads-tab";
import { sumGpuMemoryPoolGb } from "./explore-eligibility";
import { readExplorePoolOverrideGb } from "./explore-pool-storage";
import { buildHardwareProfile } from "./hardware-profile";
import { FitVerdict, HubLink, modelBrand } from "./model-brand";
import { ModelCatalogTable } from "./model-catalog-table";
import {
  FIT_BUDGET_RATIO,
  FIT_DOT_CLASS,
  FIT_TEXT_CLASS,
  FORMAT_BLURBS,
  FORMAT_LABELS,
  bestFit,
  formatContextTokens,
  formatGb,
  orderedVariants,
  variantFit,
} from "./model-fit";

export function useModelIndex() {
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

export function useHardwareProfile() {
  const [gpus, setGpus] = useState<GPU[]>([]);
  const [apiMaxVramGb, setApiMaxVramGb] = useState(0);
  const [poolOverrideGb, setPoolOverrideGb] = useState<number | null>(null);

  useMountSubscription(() => {
    setPoolOverrideGb(readExplorePoolOverrideGb());
  }, []);

  useMountSubscription(() => {
    void (async () => {
      const [presetsData, gpuData] = await Promise.all([
        api.getStarterPresets().catch(() => null),
        api.getGPUs().catch(() => ({ gpus: [] as GPU[] })),
      ]);
      setApiMaxVramGb(typeof presetsData?.max_vram_gb === "number" ? presetsData.max_vram_gb : 0);
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

/**
 * The catalog table plus its detail drawer. Tiers become group rows inside one
 * continuous table, so the column headers are stated once instead of once per
 * tier.
 */
export function PicksCatalog({
  tiers,
  poolGb,
  downloadsByModel,
  startingModelIds,
  onDownload,
}: {
  tiers: readonly ModelIndexTier[];
  poolGb: number;
  downloadsByModel: Map<string, ModelDownload>;
  startingModelIds: Set<string>;
  onDownload: (variant: ModelIndexVariant) => void;
}) {
  const [selectedModel, setSelectedModel] = useState<ModelIndexModel | null>(null);
  const groups = useMemo(
    () =>
      tiers.map((tier) => ({
        id: tier.id,
        label: tier.label,
        blurb: tier.blurb,
        models: tier.models,
      })),
    [tiers],
  );
  return (
    <>
      <ModelCatalogTable
        groups={groups}
        poolGb={poolGb}
        downloadsByModel={downloadsByModel}
        startingModelIds={startingModelIds}
        onOpen={setSelectedModel}
        onDownload={onDownload}
      />
      {selectedModel ? (
        <PickDrawer
          model={selectedModel}
          poolGb={poolGb}
          downloadsByModel={downloadsByModel}
          startingModelIds={startingModelIds}
          onDownload={onDownload}
          onClose={() => setSelectedModel(null)}
        />
      ) : null}
    </>
  );
}

/** Single-tier view, kept for the setup wizard's one-tier-at-a-time step. */
function PickDrawer({
  model,
  poolGb,
  downloadsByModel,
  startingModelIds,
  onDownload,
  onClose,
}: {
  model: ModelIndexModel;
  poolGb: number;
  downloadsByModel: Map<string, ModelDownload>;
  startingModelIds: Set<string>;
  onDownload: (variant: ModelIndexVariant) => void;
  onClose: () => void;
}) {
  const brand = modelBrand(model);
  const variants = orderedVariants(model);
  const best = bestFit(model, poolGb);
  const publishers = Array.from(
    new Set(variants.map((variant) => variant.repo.split("/")[0] ?? "")),
  ).filter(Boolean);

  return (
    <ResourceDrawer
      title={model.name}
      icon={<ModelLogo modelId={brand.repo} author={brand.owner} label={model.name} size="sm" />}
      badge={model.multimodal ? <StatusPill tone="info">vision</StatusPill> : undefined}
      status={`${brand.label} · ${model.params}`}
      footer={
        <>
          <HubLink repo={brand.repo} label="Hugging Face" />
          <ModelButton onClick={onClose}>Done</ModelButton>
        </>
      }
      onClose={onClose}
    >
      <p className="text-[length:var(--fs-md)] leading-6 text-(--ui-muted)">{model.description}</p>

      <div className="mt-4 mb-6 flex items-start gap-2.5 border-y border-(--ui-separator) py-3 text-[length:var(--fs-sm)]">
        <span
          aria-hidden
          className={cx("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", FIT_DOT_CLASS[best.fit.state])}
        />
        <div className="min-w-0">
          <div className={FIT_TEXT_CLASS[best.fit.state]}>
            <FitVerdict fit={best.fit} variant={best.variant} poolGb={poolGb} />
          </div>
          {poolGb > 0 ? (
            <div className="mt-0.5 text-[length:var(--fs-xs)] text-(--ui-muted)">
              Weights get at most {formatGb(poolGb * FIT_BUDGET_RATIO)} of your {Math.round(poolGb)}{" "}
              GB pool ({Math.round(FIT_BUDGET_RATIO * 100)}%); the rest pays for the KV cache and
              the runtime.
            </div>
          ) : null}
        </div>
      </div>

      <ResourceDrawerSection title="Model">
        <ResourceFact label="Publisher" value={brand.label} />
        {model.intelligence_index != null ? (
          <ResourceFact
            label="Intelligence Index"
            value={`${model.intelligence_index.toFixed(1)}${
              model.agentic_index != null ? ` · ${model.agentic_index.toFixed(1)} agentic` : ""
            } — Artificial Analysis`}
          />
        ) : null}
        {model.architecture ? (
          <ResourceFact label="Architecture" value={model.architecture} />
        ) : null}
        <ResourceFact label="Parameters" value={model.params} />
        {model.active_params_b != null ? (
          <ResourceFact
            label="Active per token"
            value={`${model.active_params_b}B of ${model.total_params_b ?? "—"}B — decode cost tracks this number, memory tracks the total`}
          />
        ) : null}
        <ResourceFact
          label="Max context"
          value={`${model.context_tokens.toLocaleString()} tokens (${formatContextTokens(model.context_tokens)})`}
        />
        <ResourceFact label="License" value={model.license} />
        <ResourceFact label="Input" value={model.multimodal ? "Text and images" : "Text only"} />
        <ResourceFact
          label="Quantizations"
          value={`${variants.length} across ${publishers.length} publishers`}
        />
      </ResourceDrawerSection>

      <ResourceDrawerSection
        title="Weights"
        description={
          poolGb > 0
            ? `Every build measured against your ${Math.round(poolGb)} GB pool. Pick one to start the download.`
            : "Pick a format to start the download. Alternate publishers stay visible here."
        }
      >
        {variants.map((variant) => (
          <PickVariantRow
            key={variant.repo}
            variant={variant}
            model={model}
            poolGb={poolGb}
            download={downloadsByModel.get(variant.repo) ?? null}
            isStarting={startingModelIds.has(variant.repo)}
            onDownload={onDownload}
          />
        ))}
      </ResourceDrawerSection>

      {model.notes.length ? (
        <section>
          <h3 className="text-[length:var(--fs-base)] font-medium text-(--ui-fg)">Serving notes</h3>
          <ul className="mt-2 space-y-2 border-t border-(--ui-separator) pt-3 text-[length:var(--fs-sm)] leading-5 text-(--ui-muted)">
            {model.notes.map((note) => (
              <li key={note} className="flex gap-2">
                <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-(--ui-muted)" />
                <span className="min-w-0">{note}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </ResourceDrawer>
  );
}

function PickVariantRow({
  variant,
  model,
  poolGb,
  download,
  isStarting,
  onDownload,
}: {
  variant: ModelIndexVariant;
  model: ModelIndexModel;
  poolGb: number;
  download: ModelDownload | null;
  isStarting: boolean;
  onDownload: (variant: ModelIndexVariant) => void;
}) {
  const busy = isStarting || download?.status === "downloading" || download?.status === "paused";
  const fit = variantFit(variant, model, poolGb);
  const source = variant.official
    ? "Official"
    : (variant.source ?? variant.repo.split("/")[0] ?? "Community");
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium text-(--ui-fg)">{FORMAT_LABELS[variant.format]}</span>
          <span
            className={cx(
              "rounded px-1 py-px text-[length:var(--fs-xs)]",
              variant.official
                ? "bg-(--ui-info)/12 text-(--ui-info)"
                : "bg-(--ui-hover) text-(--ui-muted)",
            )}
          >
            {source}
          </span>
          <span className="font-mono text-[length:var(--fs-xs)] text-(--ui-fg)/80">
            {formatGb(fit.sizeGb)}
            {fit.estimated ? "*" : ""}
          </span>
          <span className={cx("text-[length:var(--fs-xs)]", FIT_TEXT_CLASS[fit.state])}>
            {fit.state === "unknown"
              ? "size unknown"
              : `${fit.label}${fit.poolShare != null ? ` · ${Math.round(fit.poolShare * 100)}% of pool` : ""}`}
          </span>
          <VariantDownloadState download={download} isStarting={isStarting} />
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate font-mono text-[length:var(--fs-xs)] text-(--ui-muted)">
            {variant.repo}
          </span>
          <HubLink repo={variant.repo} />
        </div>
        <FitBar fit={fit} poolGb={poolGb} />
        <div className="mt-1 text-[length:var(--fs-xs)] leading-4 text-(--ui-muted)">
          {variant.caveat ?? FORMAT_BLURBS[variant.format]}
          {fit.estimated ? " · size estimated from the parameter count" : ""}
        </div>
      </div>
      <ModelButton tone="primary" disabled={busy} onClick={() => onDownload(variant)}>
        <DownloadCloud className="h-3 w-3" />
        {busy ? "Working" : "Download"}
      </ModelButton>
    </div>
  );
}

/**
 * How much of the pool this build eats, with the 70% budget marked. Reading a
 * bar is faster than comparing two numbers, and the notch makes "over budget"
 * obvious without needing the percentage.
 */
function FitBar({ fit, poolGb }: { fit: ReturnType<typeof variantFit>; poolGb: number }) {
  if (poolGb <= 0 || fit.poolShare == null) return null;
  const filled = Math.min(100, Math.max(1, fit.poolShare * 100));
  return (
    <div
      className="relative mt-1.5 h-1 w-full max-w-64 overflow-hidden rounded-full bg-(--ui-hover)"
      title={`${formatGb(fit.sizeGb)} of ${Math.round(poolGb)} GB`}
    >
      <span
        className={cx(
          "absolute inset-y-0 left-0 rounded-full",
          fit.state === "fits" ? "bg-(--ok)" : fit.state === "tight" ? "bg-(--warn)" : "bg-(--err)",
        )}
        style={{ width: `${filled}%` }}
      />
      <span
        aria-hidden
        className="absolute inset-y-0 w-px bg-(--ui-fg)/40"
        style={{ left: `${FIT_BUDGET_RATIO * 100}%` }}
      />
    </div>
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
    return <span className="text-[length:var(--fs-xs)] text-(--ui-info)">starting…</span>;
  }
  if (!download) return null;
  if (download.status === "downloading" || download.status === "paused") {
    return (
      <span className="text-[length:var(--fs-xs)] text-(--ui-info)">
        {downloadProgressText(download)}
      </span>
    );
  }
  if (download.status === "failed") {
    return (
      <span className="text-[length:var(--fs-xs)] text-(--err)">
        failed{download.error ? ` — ${download.error}` : ""}
      </span>
    );
  }
  if (download.status === "completed") {
    return <span className="text-[length:var(--fs-xs)] text-(--ok)">downloaded</span>;
  }
  return null;
}
