"use client";

import { Fragment, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { HuggingFaceModelCardModal, Table, TBody, THead, TH, TRow } from "@/ui";
import type { HuggingFaceModel, ModelDownload } from "@/lib/types";
import { isDerivativeModel, modelRecencyMs, originalModelKey } from "@/lib/huggingface";
import { ModelRow } from "./discover-results/model-row";

export function DiscoverResults({
  models,
  filteredModels,
  loading,
  error,
  providerFilter,
  copiedId,
  hasMore,
  isModelLocal,
  getDownloadForModel,
  startingModelIds,
  onCopyModelId,
  onRefresh,
  onLoadMore,
  onStartDownload,
  onPauseDownload,
  onResumeDownload,
}: {
  models: HuggingFaceModel[];
  filteredModels: HuggingFaceModel[];
  loading: boolean;
  error: string | null;
  providerFilter: string;
  copiedId: string | null;
  hasMore: boolean;
  isModelLocal: (modelId: string) => boolean;
  getDownloadForModel: (modelId: string) => ModelDownload | null;
  startingModelIds: Set<string>;
  onCopyModelId: (modelId: string) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  onStartDownload: (params: { model_id: string }) => Promise<void>;
  onPauseDownload: (downloadId: string) => Promise<void>;
  onResumeDownload: (downloadId: string) => Promise<void>;
}) {
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<string[]>([]);
  const [selectedModelCard, setSelectedModelCard] = useState<{
    model: HuggingFaceModel;
    variants: HuggingFaceModel[];
  } | null>(null);
  const groupedModels = useMemo(() => {
    const groups = new Map<string, HuggingFaceModel[]>();
    filteredModels.forEach((model) => {
      const key = originalModelKey(model);
      const existing = groups.get(key);
      if (existing) {
        existing.push(model);
      } else {
        groups.set(key, [model]);
      }
    });

    return Array.from(groups.entries())
      .map(([key, variants]) => {
        const sortedVariants = [...variants].sort((left, right) => {
          const derivativeDelta =
            (isDerivativeModel(left) ? 1 : 0) - (isDerivativeModel(right) ? 1 : 0);
          if (derivativeDelta !== 0) return derivativeDelta;
          if (right.likes !== left.likes) return right.likes - left.likes;
          const recencyDelta = modelRecencyMs(right) - modelRecencyMs(left);
          if (recencyDelta !== 0) return recencyDelta;
          return right.downloads - left.downloads;
        });
        return {
          key,
          lead: sortedVariants[0] as HuggingFaceModel,
          variants: sortedVariants,
        };
      })
      .sort((left, right) => {
        if (right.lead.likes !== left.lead.likes) return right.lead.likes - left.lead.likes;
        const recencyDelta = modelRecencyMs(right.lead) - modelRecencyMs(left.lead);
        if (recencyDelta !== 0) return recencyDelta;
        return right.lead.downloads - left.lead.downloads;
      });
  }, [filteredModels]);

  const toggleGroup = (groupKey: string) => {
    setExpandedGroupKeys((previous) =>
      previous.includes(groupKey)
        ? previous.filter((current) => current !== groupKey)
        : [...previous, groupKey],
    );
  };

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-(--err) mb-4">{error}</p>
        <button
          onClick={onRefresh}
          className="px-4 py-2 bg-(--surface) border border-(--border) rounded-lg text-(--fg) hover:bg-(--surface) transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (loading && models.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-(--dim)">
        <RefreshCw className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (filteredModels.length === 0) {
    return (
      <div className="text-center py-12 text-(--dim)">
        <p>No models found</p>
        <p className="text-sm mt-1">Try adjusting your search or filters</p>
      </div>
    );
  }

  return (
    <>
      <div className="text-xs text-(--dim) mb-3">
        {groupedModels.length} {groupedModels.length === 1 ? "model" : "models"}
        {groupedModels.length !== filteredModels.length && ` (${filteredModels.length} variants)`}
        {providerFilter && ` from ${providerFilter}`}
      </div>

      <Table>
        <THead>
          <TRow className="hover:bg-transparent">
            <TH>Model</TH>
            <TH>Provider</TH>
            <TH>Task</TH>
            <TH>Quantization</TH>
            <TH>Status</TH>
            <TH align="right">Stats</TH>
            <TH align="right" className="w-8" />
            <TH align="right">Action</TH>
          </TRow>
        </THead>
        <TBody>
          {groupedModels.map((group) => {
            const expanded = expandedGroupKeys.includes(group.key);
            return (
              <Fragment key={group.key}>
                <ModelRow
                  model={group.lead}
                  copied={copiedId === group.lead.modelId}
                  isLocal={isModelLocal(group.lead.modelId)}
                  activeDownload={getDownloadForModel(group.lead.modelId)}
                  isStarting={startingModelIds.has(group.lead.modelId)}
                  onCopyModelId={onCopyModelId}
                  onStartDownload={onStartDownload}
                  onPauseDownload={onPauseDownload}
                  onResumeDownload={onResumeDownload}
                  variantCount={group.variants.length}
                  expanded={expanded}
                  onToggleExpand={
                    group.variants.length > 1 ? () => toggleGroup(group.key) : undefined
                  }
                  onOpenModelCard={() =>
                    setSelectedModelCard({ model: group.lead, variants: group.variants })
                  }
                />
                {expanded &&
                  group.variants
                    .slice(1)
                    .map((model) => (
                      <ModelRow
                        key={model._id}
                        model={model}
                        copied={copiedId === model.modelId}
                        isLocal={isModelLocal(model.modelId)}
                        activeDownload={getDownloadForModel(model.modelId)}
                        isStarting={startingModelIds.has(model.modelId)}
                        onCopyModelId={onCopyModelId}
                        onStartDownload={onStartDownload}
                        onPauseDownload={onPauseDownload}
                        onResumeDownload={onResumeDownload}
                        child
                        onOpenModelCard={() =>
                          setSelectedModelCard({ model, variants: group.variants })
                        }
                      />
                    ))}
              </Fragment>
            );
          })}
        </TBody>
      </Table>

      {hasMore && (
        <div className="mt-6 text-center">
          <button
            onClick={onLoadMore}
            disabled={loading}
            className="px-4 py-2 bg-(--surface) border border-(--border) rounded-lg text-sm text-(--fg) hover:bg-(--surface) transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin" />
                Loading...
              </span>
            ) : (
              "Load More"
            )}
          </button>
        </div>
      )}
      <HuggingFaceModelCardModal
        open={Boolean(selectedModelCard)}
        model={selectedModelCard?.model ?? null}
        variants={selectedModelCard?.variants ?? []}
        onClose={() => setSelectedModelCard(null)}
      />
    </>
  );
}
