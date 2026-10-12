import { useState, type ReactNode } from "react";
import { ArrowDownUp, Check, Filter, Gauge, RefreshCw } from "@/ui/icon-registry";
import { ModelButton, SearchInput } from "@/ui";
import { POPOVER_MENU_CLASS } from "@/ui/popover";
import { GroupRow, HeadCell, TableFrame, TableNotice, TableSkeleton } from "./catalog-table-shell";
import { CatalogContextLine } from "./catalog-context-line";
import type { HuggingFaceModel } from "@/lib/types";
import { ExploreModelRow } from "./explore-model-row";
import { estimateRoughWeightsGb } from "./explore-model-stats";
import type { ModelFit } from "./hardware-profile";
import type { HardwareProfile, ModelGroup } from "./use-explore";
import { FIT_BUDGET_RATIO } from "./model-fit";

export const EXPLORE_LIBRARIES = [
  { value: "", label: "All libraries" },
  { value: "transformers", label: "Transformers" },
  { value: "pytorch", label: "PyTorch" },
  { value: "safetensors", label: "Safetensors" },
  { value: "exl3", label: "EXL3" },
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
  const poolGb = poolOverrideGb ?? (detectedPoolGb > 0 ? detectedPoolGb : maxVramGb);
  const libraryLabel =
    EXPLORE_LIBRARIES.find((option) => option.value === library)?.label ?? "All libraries";
  const sortLabel = EXPLORE_SORTS.find((option) => option.value === sort)?.label ?? "Relevance";

  return (
    <div className="space-y-3">
      <CatalogContextLine
        primary={poolGb > 0 ? `${Math.round(poolGb)} GB pool` : "No GPUs detected"}
        secondary={
          poolGb > 0
            ? `${hardwareProfile.label} — under ${Math.round(poolGb * FIT_BUDGET_RATIO)} GB (${Math.round(FIT_BUDGET_RATIO * 100)}%)`
            : "Set a memory pool to check fit."
        }
        meta={groupsCount ? `${groupsCount} results` : loading ? "searching…" : "no results"}
        actions={
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            title="Search again"
            aria-label="Search again"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-(--ui-muted) transition-colors hover:bg-(--ui-hover) hover:text-(--ui-fg) disabled:opacity-45"
          >
            <RefreshCw className={loading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
          </button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search Hugging Face…"
          className="min-w-56 flex-1"
        />
        <ListPopover
          icon={Filter}
          label="Library"
          summary={libraryLabel}
          options={EXPLORE_LIBRARIES}
          value={library}
          onChange={setLibrary}
          active={library !== ""}
        />
        <ListPopover
          icon={ArrowDownUp}
          label="Sort by"
          summary={sortLabel}
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
    </div>
  );
}

/**
 * Filter controls read as words, not as a row of identical squares: each button
 * shows the value it currently holds, so the toolbar states the query instead of
 * hiding it behind four glyphs.
 */
function LabeledPopover({
  icon: Icon,
  label,
  summary,
  active,
  children,
}: {
  icon: (props: { className?: string }) => ReactNode;
  label: string;
  summary: string;
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
        aria-expanded={open}
        title={label}
        className={`inline-flex h-9 items-center gap-2 rounded-lg border px-2.5 text-[length:var(--fs-sm)] transition-colors hover:bg-(--ui-hover) hover:text-(--ui-fg) ${
          active
            ? "border-(--ui-accent)/45 bg-(--ui-accent)/10 text-(--ui-fg)"
            : "border-(--ui-border) text-(--ui-muted)"
        }`}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="max-w-36 truncate">{summary}</span>
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
          <div className={`absolute right-0 top-full z-50 mt-1 w-52 ${POPOVER_MENU_CLASS}`}>
            <div className="px-2.5 py-1.5 text-[length:var(--fs-sm)] font-medium text-(--ui-muted)">
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
  summary,
  options,
  value,
  onChange,
  active,
}: {
  icon: (props: { className?: string }) => ReactNode;
  label: string;
  summary: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
  active?: boolean;
}) {
  return (
    <LabeledPopover icon={icon} label={label} summary={summary} active={active}>
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
              className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-[length:var(--fs-sm)] transition-colors hover:bg-(--ui-hover)"
            >
              <span className={opt.value === value ? "text-(--ui-fg)" : "text-(--ui-muted)"}>
                {opt.label}
              </span>
              {opt.value === value ? <Check className="h-3 w-3 text-(--ui-accent)" /> : null}
            </button>
          ))}
        </div>
      )}
    </LabeledPopover>
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
  const effectiveGb = poolOverrideGb ?? (detectedPoolGb > 0 ? detectedPoolGb : maxVramGb);
  return (
    <LabeledPopover
      icon={Gauge}
      label="Memory pool"
      summary={effectiveGb > 0 ? `${Math.round(effectiveGb)} GB pool` : "Set pool"}
      active={poolOverrideGb != null}
    >
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
              {maxVramGb > 0 ? `detected ${Math.round(maxVramGb)} GB` : "auto"}
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
    </LabeledPopover>
  );
}

export function DownloadStatusSection({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="text-[length:var(--fs-sm)] text-(--err)">
      Download worker: {error} — search still works, and the queue recovers on its own.
    </p>
  );
}

const EXPLORE_COLUMNS = ["Model", "Downloads", "Precision", "Memory", "Status"] as const;

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
  if (groups.length === 0) {
    if (loading) return <TableSkeleton columns={EXPLORE_COLUMNS} minWidthClass="min-w-[44rem]" />;
    const query = search.trim();
    return (
      <TableNotice
        title={
          error
            ? "Hugging Face search is unavailable"
            : query
              ? `No models matched \u201C${query}\u201D`
              : "No models available"
        }
        body={
          error ??
          (query
            ? "Try a model family, an organization, or a shorter identifier."
            : "Search the Hub above, or refresh to query Hugging Face again.")
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      <TableFrame minWidthClass="min-w-[44rem]">
        <thead>
          <tr>
            <HeadCell>Model</HeadCell>
            <HeadCell
              numeric
              title="Monthly downloads on the Hub — the closest thing to a popularity signal"
            >
              Downloads
            </HeadCell>
            <HeadCell numeric title="Quantization formats this repository publishes">
              Precision
            </HeadCell>
            <HeadCell
              numeric
              title="Estimated weight footprint, and what share of your pool that is"
            >
              Memory
            </HeadCell>
            <HeadCell numeric>Status</HeadCell>
          </tr>
        </thead>
        <tbody>
          <GroupRow
            colSpan={5}
            label="Search results"
            blurb="Open a model for details, or expand a family to see its quantizations."
            right={`${groups.length} ${groups.length === 1 ? "model" : "models"}`}
          />
          {groups.flatMap((group) =>
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
          )}
        </tbody>
      </TableFrame>
      {error ? (
        <p className="px-3 text-[length:var(--fs-xs)] text-(--warn)">
          {error} — showing the last results that loaded.
        </p>
      ) : null}
      {hasMore ? (
        <div className="px-3">
          <ModelButton onClick={loadMore} disabled={loading}>
            {loading ? "Loading…" : "Load more"}
          </ModelButton>
        </div>
      ) : null}
    </div>
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
