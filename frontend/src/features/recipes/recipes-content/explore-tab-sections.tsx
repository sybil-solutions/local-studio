import { useState, type ReactNode } from "react";
import { ArrowDownUp, Check, Filter, Gauge, RefreshCw } from "@/ui/icon-registry";
import { SearchInput } from "@/ui";
import { ModelButton, ModelSection, ModelRow, ModelValue, ModelStatus } from "./model-page";
import type { HuggingFaceModel } from "@/lib/types";
import { ExploreModelRow } from "./explore-model-row";
import { estimateRoughWeightsGb } from "./explore-model-stats";
import type { ModelFit } from "./hardware-profile";
import type { HardwareProfile, ModelGroup } from "./use-explore";

export const EXPLORE_LIBRARIES = [
  { value: "", label: "All libraries" },
  { value: "transformers", label: "Transformers" },
  { value: "pytorch", label: "PyTorch" },
  { value: "safetensors", label: "Safetensors" },
  { value: "gguf", label: "GGUF" },
  { value: "exl2", label: "EXL2" },
  { value: "awq", label: "AWQ" },
  { value: "gptq", label: "GPTQ" },
] as const;

export const EXPLORE_SORTS = [
  { value: "", label: "Relevance" },
  { value: "trendingScore", label: "Trending" },
  { value: "downloads", label: "Most downloaded" },
  { value: "likes", label: "Most liked" },
  { value: "createdAt", label: "Newest" },
] as const;

export function ExploreControls({
  groupsCount,
  maxVramGb,
  detectedPoolGb,
  poolOverrideGb,
  hardwareProfile,
  loading,
  search,
  setSearch,
  library,
  setLibrary,
  sort,
  setSort,
  setPoolOverrideGb,
  refresh,
}: {
  groupsCount: number;
  maxVramGb: number;
  detectedPoolGb: number;
  poolOverrideGb: number | null;
  hardwareProfile: HardwareProfile;
  loading: boolean;
  search: string;
  setSearch: (value: string) => void;
  library: string;
  setLibrary: (value: string) => void;
  sort: string;
  setSort: (value: string) => void;
  setPoolOverrideGb: (value: number | null) => void;
  refresh: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="Search Hugging Face models"
        className="flex-1"
      />
      <span className="shrink-0 text-[length:var(--fs-sm)] tabular-nums text-(--ui-muted)">
        {groupsCount || "defaults"}
      </span>
      <ToolbarButton onClick={refresh} disabled={loading} title="Refresh">
        <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
      </ToolbarButton>
      <ListPopover
        icon={Filter}
        label="Library"
        options={EXPLORE_LIBRARIES}
        value={library}
        onChange={setLibrary}
        active={library !== ""}
      />
      <ListPopover
        icon={ArrowDownUp}
        label="Sort by"
        options={EXPLORE_SORTS}
        value={sort}
        onChange={setSort}
        active={sort !== ""}
      />
      <VramPopover
        maxVramGb={maxVramGb}
        detectedPoolGb={detectedPoolGb}
        poolOverrideGb={poolOverrideGb}
        hardwareProfile={hardwareProfile}
        setPoolOverrideGb={setPoolOverrideGb}
      />
    </div>
  );
}

function ToolbarButton({
  children,
  onClick,
  disabled,
  title,
  active,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-(--ui-border) text-(--ui-muted) transition-colors hover:bg-(--ui-hover) hover:text-(--ui-fg) disabled:opacity-45 disabled:pointer-events-none"
    >
      {children}
      {active ? (
        <span className="absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full bg-(--ui-accent)" />
      ) : null}
    </button>
  );
}

function IconPopover({
  icon: Icon,
  label,
  active,
  children,
}: {
  icon: (props: { className?: string }) => ReactNode;
  label: string;
  active?: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={label}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-(--ui-border) text-(--ui-muted) transition-colors hover:bg-(--ui-hover) hover:text-(--ui-fg)"
      >
        <Icon className="h-3.5 w-3.5" />
        {active ? (
          <span className="absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full bg-(--ui-accent)" />
        ) : null}
      </button>
      {open ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden
            tabIndex={-1}
          />
          <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-lg border border-(--color-popover-border) bg-(--color-popover) py-1 shadow-[0_16px_44px_rgba(0,0,0,0.48)]">
            <div className="px-2.5 py-1.5 text-[length:var(--fs-xs)] font-medium uppercase tracking-wide text-(--ui-muted)">
              {label}
            </div>
            {children(() => setOpen(false))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function ListPopover({
  icon,
  label,
  options,
  value,
  onChange,
  active,
}: {
  icon: (props: { className?: string }) => ReactNode;
  label: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
  active?: boolean;
}) {
  return (
    <IconPopover icon={icon} label={label} active={active}>
      {(close) => (
        <div className="max-h-64 overflow-y-auto">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onChange(opt.value);
                close();
              }}
              className="flex w-full items-center justify-between px-2.5 py-1.5 text-[length:var(--fs-sm)] transition-colors hover:bg-(--ui-hover)"
            >
              <span className={opt.value === value ? "text-(--ui-fg)" : "text-(--ui-muted)"}>
                {opt.label}
              </span>
              {opt.value === value ? <Check className="h-3 w-3 text-(--ui-accent)" /> : null}
            </button>
          ))}
        </div>
      )}
    </IconPopover>
  );
}

function VramPopover({
  maxVramGb,
  detectedPoolGb,
  poolOverrideGb,
  hardwareProfile,
  setPoolOverrideGb,
}: {
  maxVramGb: number;
  detectedPoolGb: number;
  poolOverrideGb: number | null;
  hardwareProfile: HardwareProfile;
  setPoolOverrideGb: (value: number | null) => void;
}) {
  return (
    <IconPopover icon={Gauge} label="VRAM pool" active={poolOverrideGb != null}>
      {(close) => (
        <div className="space-y-2 px-2.5 py-2">
          <p className="text-[length:var(--fs-sm)] text-(--ui-muted)">{hardwareProfile.label}</p>
          <input
            key={poolOverrideGb === null ? "pool-auto" : `pool-${poolOverrideGb}`}
            type="number"
            inputMode="decimal"
            min={1}
            step={1}
            placeholder={detectedPoolGb > 0 ? String(Math.round(detectedPoolGb)) : "Auto"}
            defaultValue={poolOverrideGb === null ? "" : String(poolOverrideGb)}
            onBlur={(event) =>
              updatePoolOverride(event.currentTarget, poolOverrideGb, setPoolOverrideGb)
            }
            className="h-7 w-full rounded-md border border-(--ui-border) bg-(--ui-bg) px-2 text-[length:var(--fs-sm)] text-(--ui-fg) outline-none focus:ring-1 focus:ring-(--ui-accent)/40"
          />
          <div className="flex items-center justify-between">
            <span className="text-[length:var(--fs-xs)] text-(--ui-muted)">
              {maxVramGb > 0 ? `${Math.round(maxVramGb)} GB` : "auto"}
            </span>
            {poolOverrideGb != null ? (
              <button
                type="button"
                onClick={() => {
                  setPoolOverrideGb(null);
                  close();
                }}
                className="text-[length:var(--fs-xs)] text-(--ui-accent) hover:underline"
              >
                Reset to auto
              </button>
            ) : null}
          </div>
        </div>
      )}
    </IconPopover>
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
  openModelCard,
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
  openModelCard: (model: HuggingFaceModel, variants: HuggingFaceModel[], fit?: ModelFit) => void;
}) {
  return (
    <ModelSection
      title="Model results"
      description="Open a model for details. Expand a family to inspect its variants."
      actions={
        <ModelStatus tone={groups.length ? "good" : error ? "warning" : "default"}>
          {groups.length ? `${groups.length} models` : loading ? "syncing" : "empty"}
        </ModelStatus>
      }
    >
      {error ? <ExploreErrorRow error={error} /> : null}
      {groups.length > 0 ? (
        groups.flatMap((group) =>
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
            openModelCard,
          }),
        )
      ) : loading ? (
        <ExploreLoadingRows />
      ) : error ? null : (
        <ExploreEmptyRow search={search} />
      )}
      {hasMore && groups.length > 0 ? <LoadMoreRow loading={loading} loadMore={loadMore} /> : null}
    </ModelSection>
  );
}

function ExploreLoadingRows() {
  return Array.from({ length: 6 }, (_, index) => (
    <div
      key={index}
      className="grid min-h-14 grid-cols-1 gap-2 px-1 py-2.5 md:grid-cols-[minmax(260px,0.52fr)_minmax(0,0.48fr)] md:items-center md:gap-4"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="h-8 w-8 shrink-0 animate-pulse rounded-md bg-(--ui-hover)" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="h-3.5 w-4/5 animate-pulse rounded bg-(--ui-hover)" />
          <div className="h-2.5 w-2/5 animate-pulse rounded bg-(--ui-hover)/70" />
        </div>
      </div>
      <div className="flex items-center justify-end gap-3">
        <div className="h-3 w-16 animate-pulse rounded bg-(--ui-hover)/70" />
        <div className="h-3 w-20 animate-pulse rounded bg-(--ui-hover)" />
        <div className="h-6 w-24 animate-pulse rounded-md bg-(--ui-hover)/70" />
      </div>
    </div>
  ));
}

function ExploreEmptyRow({ search }: { search: string }) {
  const query = search.trim();
  return (
    <ModelRow
      label={query ? `No models matched “${query}”` : "No models available"}
      description={
        query
          ? "Try a model family, organization, or shorter identifier."
          : "Refresh to query Hugging Face again."
      }
      value={<ModelValue dim>Nothing to show</ModelValue>}
    />
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
  openModelCard,
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
  openModelCard: (model: HuggingFaceModel, variants: HuggingFaceModel[], fit?: ModelFit) => void;
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
      weightEstimateGb={group.needGb}
      pooledVramGb={maxVramGb}
      fit={group.fit}
      variants={group.variants}
      onOpenModelCard={openModelCard}
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
          fit={group.fit}
          variants={group.variants}
          onOpenModelCard={openModelCard}
        />
      )),
  );
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
