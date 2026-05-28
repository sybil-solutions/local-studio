import { ExternalLink, RefreshCw, Search } from "lucide-react";
import { ModelButton, ModelSection, ModelInput, ModelRow, ModelValue, ModelStatus } from "@/ui";
import type { ModelDownload } from "@/lib/types";
import { ExploreModelRow } from "./explore-model-row";
import { estimateRoughWeightsGb } from "./explore-model-stats";
import type { ModelGroup } from "./use-explore";

const FALLBACK_MODELS = [
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

export function ExploreControls({
  groupsCount,
  maxVramGb,
  detectedPoolGb,
  poolOverrideGb,
  gpuCount,
  loading,
  error,
  search,
  setSearch,
  setPoolOverrideGb,
  refresh,
}: {
  groupsCount: number;
  maxVramGb: number;
  detectedPoolGb: number;
  poolOverrideGb: number | null;
  gpuCount: number;
  loading: boolean;
  error: string | null;
  search: string;
  setSearch: (value: string) => void;
  setPoolOverrideGb: (value: number | null) => void;
  refresh: () => void;
}) {
  return (
    <ModelSection
      title="Explore controls"
      description="Search Hugging Face, tune pooled VRAM, and refresh without changing the page structure."
      actions={
        <ModelStatus tone={loading ? "info" : error ? "warning" : "good"}>
          {loading ? "syncing" : error ? "fallback" : "ready"}
        </ModelStatus>
      }
    >
      <ExploreSearchRow
        groupsCount={groupsCount}
        search={search}
        setSearch={setSearch}
        refresh={refresh}
        loading={loading}
      />
      <ExploreVramPoolRow
        maxVramGb={maxVramGb}
        detectedPoolGb={detectedPoolGb}
        poolOverrideGb={poolOverrideGb}
        setPoolOverrideGb={setPoolOverrideGb}
      />
      <ExploreHardwareHintRow
        gpuCount={gpuCount}
        detectedPoolGb={detectedPoolGb}
        poolOverrideGb={poolOverrideGb}
      />
    </ModelSection>
  );
}

function ExploreSearchRow({
  groupsCount,
  search,
  setSearch,
  refresh,
  loading,
}: {
  groupsCount: number;
  search: string;
  setSearch: (value: string) => void;
  refresh: () => void;
  loading: boolean;
}) {
  return (
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
      status={<ModelStatus>{groupsCount || "defaults"}</ModelStatus>}
      actions={
        <ModelButton onClick={refresh} disabled={loading} title="Refresh Explore">
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        </ModelButton>
      }
    />
  );
}

function ExploreVramPoolRow({
  maxVramGb,
  detectedPoolGb,
  poolOverrideGb,
  setPoolOverrideGb,
}: {
  maxVramGb: number;
  detectedPoolGb: number;
  poolOverrideGb: number | null;
  setPoolOverrideGb: (value: number | null) => void;
}) {
  return (
    <ModelRow
      label="VRAM pool"
      description="Manual pool wins; clearing the input returns to detected GPUs and server hints."
      control={
        <VramPoolInput
          detectedPoolGb={detectedPoolGb}
          poolOverrideGb={poolOverrideGb}
          setPoolOverrideGb={setPoolOverrideGb}
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
  );
}

function VramPoolInput({
  detectedPoolGb,
  poolOverrideGb,
  setPoolOverrideGb,
}: {
  detectedPoolGb: number;
  poolOverrideGb: number | null;
  setPoolOverrideGb: (value: number | null) => void;
}) {
  return (
    <input
      key={poolOverrideGb === null ? "pool-auto" : `pool-${poolOverrideGb}`}
      type="number"
      inputMode="decimal"
      min={1}
      step={1}
      placeholder={detectedPoolGb > 0 ? String(Math.round(detectedPoolGb)) : "Auto"}
      defaultValue={poolOverrideGb === null ? "" : String(poolOverrideGb)}
      onBlur={(event) => updatePoolOverride(event.currentTarget, poolOverrideGb, setPoolOverrideGb)}
      className="h-7 w-full rounded-md border border-transparent bg-(--surface) px-2.5 text-[12px] text-(--fg) outline-none transition placeholder:text-(--dim)/65 focus:bg-(--bg) focus:ring-1 focus:ring-(--hl1)/60"
      title="Override total VRAM pool for Explore."
    />
  );
}

function ExploreHardwareHintRow({
  gpuCount,
  detectedPoolGb,
  poolOverrideGb,
}: {
  gpuCount: number;
  detectedPoolGb: number;
  poolOverrideGb: number | null;
}) {
  return (
    <ModelRow
      label="Hardware hint"
      description="Detected GPU pool from the controller, plus manual override state."
      value={<ModelValue>{hardwareHintText(gpuCount, detectedPoolGb)}</ModelValue>}
      status={<ModelStatus>{poolOverrideGb != null ? "manual" : "detected"}</ModelStatus>}
    />
  );
}

export function DownloadStatusSection({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <ModelSection
      title="Download status"
      description="Server-side download errors stay visible as rows."
    >
      <ModelRow
        label="Download worker"
        description="The model browser remains usable while the download endpoint recovers."
        value={<ModelValue dim>{error}</ModelValue>}
        status={<ModelStatus tone="danger">error</ModelStatus>}
      />
    </ModelSection>
  );
}

export function ExploreResultsSection({
  groups,
  expandedKeys,
  search,
  loading,
  error,
  hasMore,
  maxVramGb,
  downloadsByModel,
  startingModelIds,
  isLocal,
  toggleExpand,
  startDownload,
  pauseDownload,
  resumeDownload,
  loadMore,
}: {
  groups: ModelGroup[];
  expandedKeys: Set<string>;
  search: string;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  maxVramGb: number;
  downloadsByModel: Map<string, import("@/lib/types").ModelDownload>;
  startingModelIds: Set<string>;
  isLocal: (modelId: string) => boolean;
  toggleExpand: (key: string) => void;
  startDownload: (modelId: string) => void;
  pauseDownload: (id: string) => void;
  resumeDownload: (id: string) => void;
  loadMore: () => void;
}) {
  return (
    <ModelSection
      title="Model results"
      description="Rows preserve provider, format, VRAM fit, engagement, download state, and source link."
      actions={
        <ModelStatus tone={groups.length ? "good" : error ? "warning" : "default"}>
          {groups.length ? `${groups.length} models` : "defaults"}
        </ModelStatus>
      }
    >
      {error ? <ExploreErrorRow error={error} /> : null}
      {groups.length > 0
        ? groups.flatMap((group) =>
            exploreGroupRows({
              group,
              expanded: expandedKeys.has(group.key),
              maxVramGb,
              downloadsByModel,
              startingModelIds,
              isLocal,
              toggleExpand,
              startDownload,
              pauseDownload,
              resumeDownload,
            }),
          )
        : fallbackRows(search, loading)}
      {hasMore && groups.length > 0 ? <LoadMoreRow loading={loading} loadMore={loadMore} /> : null}
    </ModelSection>
  );
}

function ExploreErrorRow({ error }: { error: string }) {
  return (
    <ModelRow
      label="Explore API"
      description="Remote discovery failed, so curated fallback rows are shown below."
      value={<ModelValue dim>{error}</ModelValue>}
      status={<ModelStatus tone="warning">fallback</ModelStatus>}
    />
  );
}

function LoadMoreRow({ loading, loadMore }: { loading: boolean; loadMore: () => void }) {
  return (
    <ModelRow
      label="More results"
      description="Fetch the next page from Hugging Face."
      value={
        <ModelValue dim>{loading ? "Loading next page…" : "Additional rows available"}</ModelValue>
      }
      status={<ModelStatus>{loading ? "loading" : "ready"}</ModelStatus>}
      actions={
        <ModelButton onClick={loadMore} disabled={loading}>
          Load more
        </ModelButton>
      }
    />
  );
}

function exploreGroupRows({
  group,
  expanded,
  maxVramGb,
  downloadsByModel,
  startingModelIds,
  isLocal,
  toggleExpand,
  startDownload,
  pauseDownload,
  resumeDownload,
}: {
  group: ModelGroup;
  expanded: boolean;
  maxVramGb: number;
  downloadsByModel: Map<string, import("@/lib/types").ModelDownload>;
  startingModelIds: Set<string>;
  isLocal: (modelId: string) => boolean;
  toggleExpand: (key: string) => void;
  startDownload: (modelId: string) => void;
  pauseDownload: (id: string) => void;
  resumeDownload: (id: string) => void;
}) {
  const rows = [
    <ExploreModelRow
      key={group.key}
      model={group.lead}
      isLocal={isLocal(group.lead.modelId)}
      activeDownload={downloadsByModel.get(group.lead.modelId) ?? null}
      isStarting={startingModelIds.has(group.lead.modelId)}
      onStartDownload={startDownload}
      onPauseDownload={pauseDownload}
      onResumeDownload={resumeDownload}
      variantCount={group.variants.length}
      expanded={expanded}
      onToggleExpand={group.variants.length > 1 ? () => toggleExpand(group.key) : undefined}
      displayDownloads={group.maxDownloads}
      displayLikes={group.maxLikes}
      weightEstimateGb={group.needGb}
      pooledVramGb={maxVramGb}
    />,
  ];
  if (!expanded) return rows;
  return rows.concat(
    group.variants
      .slice(1)
      .map((variant) => (
        <ExploreModelRow
          key={variant._id}
          model={variant}
          isLocal={isLocal(variant.modelId)}
          activeDownload={downloadsByModel.get(variant.modelId) ?? null}
          isStarting={startingModelIds.has(variant.modelId)}
          onStartDownload={startDownload}
          onPauseDownload={pauseDownload}
          onResumeDownload={resumeDownload}
          variantCount={1}
          expanded={false}
          child
          weightEstimateGb={estimateRoughWeightsGb(variant)}
          pooledVramGb={maxVramGb}
        />
      )),
  );
}

function fallbackRows(search: string, loading: boolean) {
  return FALLBACK_MODELS.map(([label, description, value]) => (
    <ModelRow
      key={label}
      label={label}
      description={fallbackDescription(search, description)}
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
  ));
}

function fallbackDescription(search: string, description: string) {
  const query = search.trim();
  return query ? `No exact match yet for "${query}". ${description}` : description;
}

function hardwareHintText(gpuCount: number, detectedPoolGb: number) {
  if (gpuCount > 0) return `${gpuCount} GPU${gpuCount === 1 ? "" : "s"} detected`;
  if (detectedPoolGb > 0) return `${Math.round(detectedPoolGb)} GB reported`;
  return "No live GPU hint; estimates remain visible";
}

function updatePoolOverride(
  input: HTMLInputElement,
  poolOverrideGb: number | null,
  setPoolOverrideGb: (value: number | null) => void,
) {
  const trimmed = input.value.trim();
  if (!trimmed) {
    setPoolOverrideGb(null);
    return;
  }
  const parsed = parseFloat(trimmed.replace(/,/g, ""));
  if (Number.isFinite(parsed) && parsed > 0) {
    setPoolOverrideGb(parsed);
    return;
  }
  input.value = poolOverrideGb === null ? "" : String(poolOverrideGb);
}
