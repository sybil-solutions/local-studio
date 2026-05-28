"use client";

import { memo, useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  DownloadCloud,
  ExternalLink,
  Pause,
  Play,
  RefreshCw,
  Search,
} from "lucide-react";
import type { HuggingFaceModel, ModelDownload } from "@/lib/types";
import { formatBytes, formatNumber } from "@/lib/formatters";
import {
  ModelButton,
  ModelSection,
  ModelInput,
  ModelRow,
  ModelValue,
  ModelStatus,
  type ModelStatusTone,
} from "./model-page-primitives";
import { extractProvider, extractQuantizations } from "@/app/discover/_components/utils";
import { useExplore } from "./use-explore";
import { useDownloads } from "@/hooks/use-downloads";
import api from "@/lib/api";
import { estimateRoughWeightsGb } from "./explore-model-stats";

function ExploreVramCell({ needGb, poolGb }: { needGb: number | null; poolGb: number }) {
  if (needGb == null || !Number.isFinite(needGb)) {
    return <span className="text-xs text-(--dim)">—</span>;
  }
  const label = needGb < 10 ? needGb.toFixed(1) : Math.round(needGb).toString();
  if (poolGb <= 0) {
    return (
      <span className="text-xs text-(--dim)" title="Rough weight estimate from name and tags">
        ~{label} GB
      </span>
    );
  }
  const over = needGb > poolGb;
  return (
    <span
      className={`text-xs ${over ? "text-(--err)" : "text-(--dim)"}`}
      title="Estimated footprint vs pooled GPU VRAM (recipe data when available, else heuristic)"
    >
      ~{label} / {Math.round(poolGb)} GB
    </span>
  );
}

const ExploreModelRow = memo(function ExploreModelRow({
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
  displayDownloads,
  displayLikes,
  weightEstimateGb,
  pooledVramGb,
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
  /** When set (e.g. grouped explore row), overrides per-variant HF stats. */
  displayDownloads?: number;
  displayLikes?: number;
  weightEstimateGb?: number | null;
  pooledVramGb: number;
}) {
  const provider = useMemo(() => extractProvider(model.modelId), [model.modelId]);
  const quants = useMemo(() => extractQuantizations(model.tags), [model.tags]);
  const [copied, setCopied] = useState(false);

  const copyId = useCallback(() => {
    navigator.clipboard.writeText(model.modelId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [model.modelId]);

  const downloadTone: ModelStatusTone = isLocal
    ? "good"
    : activeDownload?.status === "failed"
      ? "danger"
      : activeDownload
        ? "info"
        : "default";
  const downloadLabel = isLocal
    ? "local"
    : isStarting
      ? "starting"
      : activeDownload
        ? activeDownload.status
        : "remote";

  return (
    <ModelRow
      label={child ? model.modelId.split("/").pop() || model.modelId : model.modelId}
      description={`${provider}${variantCount > 1 && !child ? ` · ${variantCount} variants` : ""}`}
      value={
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-(--dim)">
          <span className="font-mono text-(--fg)">
            {quants.length ? quants.join(", ") : "format unknown"}
          </span>
          <ExploreVramCell needGb={weightEstimateGb ?? null} poolGb={pooledVramGb} />
          <span>{formatNumber(displayDownloads ?? model.downloads)} downloads</span>
          <span>{formatNumber(displayLikes ?? model.likes)} likes</span>
        </div>
      }
      status={<ModelStatus tone={downloadTone}>{downloadLabel}</ModelStatus>}
      actions={
        <>
          {variantCount > 1 && !child && onToggleExpand ? (
            <ModelButton
              onClick={onToggleExpand}
              title={expanded ? "Hide variants" : "Show variants"}
            >
              {expanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
            </ModelButton>
          ) : null}
          <ModelButton onClick={copyId} title="Copy model id">
            {copied ? <Check className="h-3 w-3 text-(--hl2)" /> : <Copy className="h-3 w-3" />}
          </ModelButton>
          {activeDownload?.status === "downloading" ? (
            <ModelButton
              onClick={() => onPauseDownload(activeDownload.id)}
              title="Pause server download"
            >
              <Pause className="h-3 w-3" />
            </ModelButton>
          ) : activeDownload?.status === "paused" || activeDownload?.status === "failed" ? (
            <ModelButton
              onClick={() => onResumeDownload(activeDownload.id)}
              title="Resume server download"
            >
              <Play className="h-3 w-3" />
            </ModelButton>
          ) : !isLocal ? (
            <ModelButton
              onClick={() => onStartDownload(model.modelId)}
              disabled={isStarting}
              tone="primary"
            >
              <DownloadCloud className="h-3 w-3" />
              Download
            </ModelButton>
          ) : null}
          <a
            href={`https://huggingface.co/${model.modelId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-7 items-center justify-center rounded-md px-2 text-[11px] text-(--dim) transition-colors hover:bg-(--hover) hover:text-(--fg)"
            title="Open on Hugging Face"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        </>
      }
    >
      {activeDownload ? (
        <div
          className="text-[11px] text-(--dim)"
          title={`Server path: ${activeDownload.target_dir}`}
        >
          {formatBytes(activeDownload.downloaded_bytes)} / {formatBytes(activeDownload.total_bytes)}{" "}
          · {activeDownload.target_dir}
        </div>
      ) : null}
    </ModelRow>
  );
});

export function ExploreTab() {
  const {
    groups,
    maxVramGb,
    detectedPoolGb,
    poolOverrideGb,
    setPoolOverrideGb,
    gpuCount,
    loading,
    error,
    search,
    hasMore,
    setSearch,
    loadMore,
    refresh,
  } = useExplore();
  const {
    downloads,
    downloadsByModel,
    startingModelIds,
    error: downloadError,
    startDownload,
    pauseDownload,
    resumeDownload,
  } = useDownloads();
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [localModelIds, setLocalModelIds] = useState<Set<string>>(new Set());
  const completedSet = useRef<Set<string>>(new Set());

  const loadLocalModels = useCallback(async () => {
    try {
      const data = await api.getModels();
      const ids = new Set<string>();
      for (const m of data.models || []) {
        ids.add(m.name.toLowerCase());
        for (const part of m.path.split("/")) {
          if (part) ids.add(part.toLowerCase());
        }
      }
      setLocalModelIds(ids);
    } catch {}
  }, []);

  const subscribeLocalModels = useCallback(
    (_notify: () => void) => {
      void loadLocalModels();
      return () => {};
    },
    [loadLocalModels],
  );

  const subscribeCompletedDownloads = useCallback(
    (_notify: () => void) => {
      let shouldRefresh = false;
      for (const d of downloads) {
        if (d.status === "completed" && !completedSet.current.has(d.id)) {
          completedSet.current.add(d.id);
          shouldRefresh = true;
        }
      }
      if (shouldRefresh) {
        void loadLocalModels();
      }
      return () => {};
    },
    [downloads, loadLocalModels],
  );

  useSyncExternalStore(subscribeLocalModels, getExploreTabSnapshot, getExploreTabSnapshot);
  useSyncExternalStore(subscribeCompletedDownloads, getExploreTabSnapshot, getExploreTabSnapshot);

  const isLocal = useCallback(
    (modelId: string) => {
      const normalized = modelId.toLowerCase();
      return localModelIds.has(normalized) || localModelIds.has(normalized.split("/").pop() ?? "");
    },
    [localModelIds],
  );

  const toggleExpand = useCallback((key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleStartDownload = useCallback(
    async (modelId: string) => {
      await startDownload({ model_id: modelId });
    },
    [startDownload],
  );

  const handlePause = useCallback(
    async (id: string) => {
      await pauseDownload(id);
    },
    [pauseDownload],
  );

  const handleResume = useCallback(
    async (id: string) => {
      await resumeDownload(id);
    },
    [resumeDownload],
  );

  const fallbackModels = [
    [
      "Qwen/Qwen3-32B",
      "Recent dense model family with strong local-serving coverage.",
      "~64 GB · text-generation",
    ],
    [
      "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B",
      "Reasoning-oriented fallback suggestion for search and downloads.",
      "~64 GB · reasoning",
    ],
    [
      "microsoft/Phi-4-mini-instruct",
      "Small template row that keeps Explore useful on limited VRAM.",
      "~8 GB · compact",
    ],
  ] as const;

  return (
    <div className="space-y-5">
      <ModelSection
        title="Explore controls"
        description="Search Hugging Face, tune pooled VRAM, and refresh without changing the page structure."
        actions={
          <ModelStatus tone={loading ? "info" : error ? "warning" : "good"}>
            {loading ? "syncing" : error ? "fallback" : "ready"}
          </ModelStatus>
        }
      >
        <ModelRow
          label="Search models"
          description="Repo id, family name, quantization tag, or provider."
          control={
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-(--dim)" />
              <ModelInput
                value={search}
                onChange={setSearch}
                placeholder="Search Hugging Face models"
                className="pl-8"
              />
            </div>
          }
          status={<ModelStatus>{groups.length || "defaults"}</ModelStatus>}
          actions={
            <ModelButton onClick={refresh} disabled={loading} title="Refresh Explore">
              <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            </ModelButton>
          }
        />
        <ModelRow
          label="VRAM pool"
          description="Manual pool wins; clearing the input returns to detected GPUs and server hints."
          control={
            <input
              key={poolOverrideGb === null ? "pool-auto" : `pool-${poolOverrideGb}`}
              type="number"
              inputMode="decimal"
              min={1}
              step={1}
              placeholder={detectedPoolGb > 0 ? String(Math.round(detectedPoolGb)) : "Auto"}
              defaultValue={poolOverrideGb === null ? "" : String(poolOverrideGb)}
              onBlur={(event) => {
                const trimmed = event.target.value.trim();
                if (!trimmed) {
                  setPoolOverrideGb(null);
                  return;
                }
                const parsed = parseFloat(trimmed.replace(/,/g, ""));
                if (!Number.isFinite(parsed) || parsed <= 0) {
                  event.target.value = poolOverrideGb === null ? "" : String(poolOverrideGb);
                  return;
                }
                setPoolOverrideGb(parsed);
              }}
              className="h-7 w-full rounded-md border border-transparent bg-(--surface) px-2.5 text-[12px] text-(--fg) outline-none transition placeholder:text-(--dim)/65 focus:bg-(--bg) focus:ring-1 focus:ring-(--hl1)/60"
              title="Override total VRAM pool for Explore."
            />
          }
          status={
            <ModelStatus tone={maxVramGb > 0 ? "info" : "default"}>
              {maxVramGb > 0 ? `${Math.round(maxVramGb)} GB` : "auto"}
            </ModelStatus>
          }
          actions={
            poolOverrideGb != null ? (
              <ModelButton onClick={() => setPoolOverrideGb(null)}>Auto</ModelButton>
            ) : null
          }
        />
        <ModelRow
          label="Hardware hint"
          description="Detected GPU pool from the controller, plus manual override state."
          value={
            <ModelValue>
              {gpuCount > 0
                ? `${gpuCount} GPU${gpuCount === 1 ? "" : "s"} detected`
                : detectedPoolGb > 0
                  ? `${Math.round(detectedPoolGb)} GB reported`
                  : "No live GPU hint; estimates remain visible"}
            </ModelValue>
          }
          status={<ModelStatus>{poolOverrideGb != null ? "manual" : "detected"}</ModelStatus>}
        />
      </ModelSection>

      {downloadError ? (
        <ModelSection
          title="Download status"
          description="Server-side download errors stay visible as rows."
        >
          <ModelRow
            label="Download worker"
            description="The model browser remains usable while the download endpoint recovers."
            value={<ModelValue dim>{downloadError}</ModelValue>}
            status={<ModelStatus tone="danger">error</ModelStatus>}
          />
        </ModelSection>
      ) : null}

      <ModelSection
        title="Model results"
        description="Rows preserve provider, format, VRAM fit, engagement, download state, and source link."
        actions={
          <ModelStatus tone={groups.length ? "good" : error ? "warning" : "default"}>
            {groups.length ? `${groups.length} models` : "defaults"}
          </ModelStatus>
        }
      >
        {error ? (
          <ModelRow
            label="Explore API"
            description="Remote discovery failed, so curated fallback rows are shown below."
            value={<ModelValue dim>{error}</ModelValue>}
            status={<ModelStatus tone="warning">fallback</ModelStatus>}
          />
        ) : null}

        {groups.length > 0
          ? groups.flatMap((group) => {
              const expanded = expandedKeys.has(group.key);
              const rows = [
                <ExploreModelRow
                  key={group.key}
                  model={group.lead}
                  isLocal={isLocal(group.lead.modelId)}
                  activeDownload={downloadsByModel.get(group.lead.modelId) ?? null}
                  isStarting={startingModelIds.has(group.lead.modelId)}
                  onStartDownload={handleStartDownload}
                  onPauseDownload={handlePause}
                  onResumeDownload={handleResume}
                  variantCount={group.variants.length}
                  expanded={expanded}
                  onToggleExpand={
                    group.variants.length > 1 ? () => toggleExpand(group.key) : undefined
                  }
                  displayDownloads={group.maxDownloads}
                  displayLikes={group.maxLikes}
                  weightEstimateGb={group.needGb}
                  pooledVramGb={maxVramGb}
                />,
              ];
              if (expanded) {
                rows.push(
                  ...group.variants
                    .slice(1)
                    .map((variant) => (
                      <ExploreModelRow
                        key={variant._id}
                        model={variant}
                        isLocal={isLocal(variant.modelId)}
                        activeDownload={downloadsByModel.get(variant.modelId) ?? null}
                        isStarting={startingModelIds.has(variant.modelId)}
                        onStartDownload={handleStartDownload}
                        onPauseDownload={handlePause}
                        onResumeDownload={handleResume}
                        variantCount={1}
                        expanded={false}
                        child
                        weightEstimateGb={estimateRoughWeightsGb(variant)}
                        pooledVramGb={maxVramGb}
                      />
                    )),
                );
              }
              return rows;
            })
          : fallbackModels.map(([label, description, value]) => (
              <ModelRow
                key={label}
                label={label}
                description={
                  search.trim()
                    ? `No exact match yet for "${search.trim()}". ${description}`
                    : description
                }
                value={<ModelValue mono>{value}</ModelValue>}
                status={<ModelStatus>{loading ? "syncing" : "fallback"}</ModelStatus>}
                actions={
                  <a
                    href={`https://huggingface.co/${label}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-7 items-center justify-center rounded-md px-2 text-[11px] text-(--dim) transition-colors hover:bg-(--hover) hover:text-(--fg)"
                  >
                    <ExternalLink className="h-3 w-3" />
                  </a>
                }
              />
            ))}

        {hasMore && groups.length > 0 ? (
          <ModelRow
            label="More results"
            description="Fetch the next page from Hugging Face."
            value={
              <ModelValue dim>
                {loading ? "Loading next page…" : "Additional rows available"}
              </ModelValue>
            }
            status={<ModelStatus>{loading ? "loading" : "ready"}</ModelStatus>}
            actions={
              <ModelButton onClick={loadMore} disabled={loading}>
                Load more
              </ModelButton>
            }
          />
        ) : null}
      </ModelSection>
    </div>
  );
}

const getExploreTabSnapshot = (): number => 0;
