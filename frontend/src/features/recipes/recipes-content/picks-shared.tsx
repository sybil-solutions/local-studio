"use client";

import { useCallback, useMemo, useState } from "react";
import { Brain, ChevronRight, DownloadCloud, Eye, Zap } from "@/ui/icon-registry";
import { ModelButton } from "@/ui";
import { ModelLogo } from "@/ui/model-logo";
import { ResourceDrawer, ResourceDrawerSection, ResourceFact } from "@/ui/resource-drawer";
import { ModelStatus } from "./model-page";
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
import { useMountSubscription } from "@/hooks/use-mount-subscription";
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

const MODEL_BRANDS: Record<string, { label: string; color: string }> = {
  qwen: { label: "Qwen", color: "#5B7CFA" },
  google: { label: "Google", color: "#4285F4" },
  "stepfun-ai": { label: "StepFun", color: "#4E9C81" },
  "deepseek-ai": { label: "DeepSeek", color: "#4D6BFE" },
  tencent: { label: "Tencent", color: "#2A7DE1" },
  minimaxai: { label: "MiniMax", color: "#D36E4D" },
  "zai-org": { label: "Z.ai", color: "#68728A" },
};

type ModelBrand = {
  owner: string;
  label: string;
  color: string;
  repo: string;
};

function formatContextTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return "—";
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}K` : String(tokens);
}

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

export function TierSection({
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
  const [selectedModel, setSelectedModel] = useState<ModelIndexModel | null>(null);
  return (
    <>
      <section className="min-w-0">
        <div className="flex min-h-9 items-end justify-between gap-4 border-b border-(--ui-border)/75 pb-2">
          <div className="min-w-0">
            <h3 className="text-[length:var(--fs-md)] font-medium text-(--ui-fg)">{tier.label}</h3>
            <p className="mt-0.5 text-[length:var(--fs-sm)] text-(--ui-muted)">{tier.blurb}</p>
          </div>
          <span className="shrink-0 text-[length:var(--fs-xs)] text-(--ui-muted)">
            {tier.models.length} {tier.models.length === 1 ? "model" : "models"}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 pt-3 lg:grid-cols-2">
          {tier.models.map((model) => (
            <PickCard key={model.id} model={model} onOpen={() => setSelectedModel(model)} />
          ))}
        </div>
      </section>
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

function modelBrand(model: ModelIndexModel): ModelBrand {
  const variant = model.variants.find((candidate) => candidate.official) ?? model.variants[0];
  const repo = variant?.repo ?? model.id;
  const owner = repo.split("/")[0]?.trim() || model.id;
  const brand = MODEL_BRANDS[owner.toLowerCase()];
  return {
    owner,
    label: brand?.label ?? owner,
    color: brand?.color ?? "#64748B",
    repo,
  };
}

function modelFormatCount(model: ModelIndexModel): number {
  return new Set(model.variants.map((variant) => variant.format)).size;
}

export function PickCard({ model, onOpen }: { model: ModelIndexModel; onOpen: () => void }) {
  const brand = modelBrand(model);
  const formatCount = modelFormatCount(model);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${model.name} details`}
      className="group relative min-h-40 w-full overflow-hidden rounded-xl border p-4 text-left transition-[background-color,border-color,transform] hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring) active:translate-y-px"
      style={{
        backgroundColor: `${brand.color}0D`,
        borderColor: `${brand.color}38`,
      }}
    >
      <span
        className="absolute inset-y-0 left-0 w-0.5 opacity-80"
        style={{ backgroundColor: brand.color }}
      />
      <div className="flex h-full min-h-32 flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <ModelLogo
              modelId={brand.repo}
              author={brand.owner}
              label={model.name}
              size="lg"
              className="rounded-lg"
            />
            <div className="min-w-0">
              <div className="text-[length:var(--fs-xs)] font-medium uppercase tracking-[0.12em] text-(--ui-muted)">
                {brand.label}
              </div>
              <h4 className="mt-0.5 truncate text-[length:var(--fs-lg)] font-medium tracking-tight text-(--ui-fg)">
                {model.name}
              </h4>
            </div>
          </div>
          <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-(--ui-muted) transition-transform group-hover:translate-x-0.5" />
        </div>
        <p className="mt-3 line-clamp-2 text-[length:var(--fs-sm)] leading-5 text-(--ui-muted)">
          {model.description}
        </p>
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-3 font-mono text-[length:var(--fs-xs)] text-(--ui-muted)">
          <span>{model.params}</span>
          <span>{formatContextTokens(model.context_tokens)} ctx</span>
          <span>
            {formatCount} {formatCount === 1 ? "format" : "formats"}
          </span>
          {model.role ? (
            <span className="ml-auto inline-flex items-center gap-1 font-sans font-medium">
              {model.role === "fast" ? <Zap className="h-3 w-3" /> : <Brain className="h-3 w-3" />}
              {model.role}
            </span>
          ) : model.multimodal ? (
            <span className="ml-auto inline-flex items-center gap-1 font-sans font-medium">
              <Eye className="h-3 w-3" />
              multimodal
            </span>
          ) : null}
        </div>
      </div>
    </button>
  );
}

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
  const variants = FORMAT_ORDER.flatMap((format) =>
    model.variants.filter((variant) => variant.format === format),
  );
  return (
    <ResourceDrawer
      title={model.name}
      icon={<ModelLogo modelId={brand.repo} author={brand.owner} label={model.name} size="sm" />}
      badge={model.multimodal ? <ModelStatus tone="info">multimodal</ModelStatus> : undefined}
      status={`${brand.label} · ${model.params}`}
      footer={<ModelButton onClick={onClose}>Done</ModelButton>}
      onClose={onClose}
    >
      <p className="mb-5 text-[length:var(--fs-md)] leading-6 text-(--ui-muted)">
        {model.description}
      </p>
      <ResourceDrawerSection title="Model">
        <ResourceFact label="Company" value={brand.label} />
        <ResourceFact label="Architecture" value={model.params} />
        <ResourceFact
          label="Context"
          value={`${formatContextTokens(model.context_tokens)} tokens`}
        />
        <ResourceFact label="License" value={model.license} />
        <ResourceFact label="Input" value={model.multimodal ? "Text and media" : "Text"} />
      </ResourceDrawerSection>
      <ResourceDrawerSection
        title="Available weights"
        description="Choose a format to start the download. Alternate publishers stay visible here."
      >
        {variants.map((variant) => (
          <PickVariantRow
            key={variant.repo}
            variant={variant}
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
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </ResourceDrawer>
  );
}

function PickVariantRow({
  variant,
  poolGb,
  download,
  isStarting,
  onDownload,
}: {
  variant: ModelIndexVariant;
  poolGb: number;
  download: ModelDownload | null;
  isStarting: boolean;
  onDownload: (variant: ModelIndexVariant) => void;
}) {
  const busy = isStarting || download?.status === "downloading" || download?.status === "paused";
  const source = variant.official
    ? "Official"
    : (variant.source ?? variant.repo.split("/")[0] ?? "Community");
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-(--ui-fg)">{FORMAT_LABELS[variant.format]}</span>
          <span className="text-[length:var(--fs-xs)] text-(--ui-muted)">{source}</span>
        </div>
        <div className="mt-0.5 truncate font-mono text-[length:var(--fs-xs)] text-(--ui-muted)">
          {variant.repo}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          {variant.size_gb != null ? (
            <span className="font-mono text-[length:var(--fs-xs)] text-(--ui-muted)">
              {variant.size_gb} GB
            </span>
          ) : null}
          <VariantFitBadge sizeGb={variant.size_gb} poolGb={poolGb} />
          <VariantDownloadState download={download} isStarting={isStarting} />
        </div>
        {variant.caveat ? (
          <div className="mt-1 text-[length:var(--fs-xs)] leading-4 text-(--ui-muted)">
            {variant.caveat}
          </div>
        ) : null}
      </div>
      <ModelButton tone="primary" disabled={busy} onClick={() => onDownload(variant)}>
        <DownloadCloud className="h-3 w-3" />
        {busy ? "Working" : "Download"}
      </ModelButton>
    </div>
  );
}

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
