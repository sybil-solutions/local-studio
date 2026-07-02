"use client";

import type { PeakMetrics } from "@/lib/types";
import type { SortDirection, SortField } from "@/features/usage/model-performance-table-model";
import { Fragment } from "react";
import { ChevronDown, ChevronUp } from "@/ui/icon-registry";
import { SortableTH, Table, TBody, TCell, THead, TH, TRow } from "@/ui";
import {
  MetricMeter,
  MetricPanel,
  MiniBarChart,
  StackedMetricBar,
} from "@/features/usage/metric-visuals";
import { formatNumber, formatDurationOrUnavailable } from "@/lib/formatters";
import { getModelColor } from "@/features/usage/colors";
import {
  modelDisplayName,
  resolveSpeedDisplay,
  type ModelData,
  type SpeedDisplay,
} from "./model-performance-table-model";

interface ModelPerformanceTableProps {
  sortedModels: ModelData[];
  peakMetrics: Map<string, PeakMetrics>;
  modelColorIndex: Map<string, number>;
  expandedRows: Set<string>;
  sortField: SortField;
  sortDirection: SortDirection;
  handleSort: (field: SortField) => void;
  toggleRow: (model: string) => void;
}

interface ModelScale {
  requests: number;
  tokens: number;
  latency: number;
  ttft: number;
}

const scaleFor = (models: ModelData[]): ModelScale => ({
  requests: Math.max(...models.map((model) => model.requests), 1),
  tokens: Math.max(...models.map((model) => model.total_tokens), 1),
  latency: Math.max(...models.map((model) => model.avg_latency_ms ?? 0), 1),
  ttft: Math.max(...models.map((model) => model.avg_ttft_ms ?? 0), 1),
});

const ratio = (value: number | null | undefined, max: number): number =>
  Math.max(0, Math.min(100, ((value ?? 0) / (max > 0 ? max : 1)) * 100));

export function ModelPerformanceTable({
  expandedRows,
  handleSort,
  modelColorIndex,
  peakMetrics,
  sortDirection,
  sortField,
  sortedModels,
  toggleRow,
}: ModelPerformanceTableProps) {
  const scale = scaleFor(sortedModels);
  return (
    <section className="px-2 pt-2 pb-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="font-mono text-[length:var(--fs-2xs)] font-medium uppercase tracking-[0.18em] text-(--dim)/75">
          Model performance
        </div>
        <div className="font-mono text-[length:var(--fs-xs)] text-(--dim)">
          <span className="tabular-nums text-(--fg)">{sortedModels.length}</span> models
        </div>
      </div>

      <Table
        bordered={false}
        className="border-b border-(--border)/40"
        tableClassName="text-[length:var(--fs-md)]"
      >
        <THead className="bg-transparent">
          <TRow className="border-b border-(--border)/40 hover:bg-transparent">
            <TH className="w-6 px-2 py-2" />
            <SortableTH
              field="model"
              currentField={sortField}
              direction={sortDirection}
              onSort={handleSort}
            >
              Model
            </SortableTH>
            <SortableTH
              field="requests"
              currentField={sortField}
              direction={sortDirection}
              onSort={handleSort}
              align="right"
            >
              Requests
            </SortableTH>
            <SortableTH
              field="tokens"
              currentField={sortField}
              direction={sortDirection}
              onSort={handleSort}
              align="right"
            >
              Tokens
            </SortableTH>
            <SortableTH
              field="latency"
              currentField={sortField}
              direction={sortDirection}
              onSort={handleSort}
              align="right"
            >
              Latency
            </SortableTH>
            <SortableTH
              field="ttft"
              currentField={sortField}
              direction={sortDirection}
              onSort={handleSort}
              align="right"
            >
              TTFT
            </SortableTH>
            <SortableTH
              field="speed"
              currentField={sortField}
              direction={sortDirection}
              onSort={handleSort}
              align="right"
            >
              Speed
            </SortableTH>
            <SortableTH
              field="cache_hit_rate"
              currentField={sortField}
              direction={sortDirection}
              onSort={handleSort}
              align="right"
            >
              Cache hit %
            </SortableTH>
          </TRow>
        </THead>
        <TBody className="divide-y-0">
          {sortedModels.map((model) => {
            const peak = peakMetrics.get(model.model);
            const isExpanded = expandedRows.has(model.model);
            const modelColor = getModelColor(modelColorIndex.get(model.model) ?? 0);

            return (
              <Fragment key={model.model}>
                <TRow
                  className={`cursor-pointer border-b border-(--border)/25 transition-colors hover:bg-(--hover) ${
                    isExpanded ? "bg-(--hover)" : ""
                  }`}
                  onClick={() => toggleRow(model.model)}
                >
                  <TCell className="px-2 py-2">
                    {isExpanded ? (
                      <ChevronDown className="h-3 w-3 text-(--dim)" />
                    ) : (
                      <ChevronUp className="h-3 w-3 rotate-[-90deg] text-(--dim)" />
                    )}
                  </TCell>
                  <TCell className="px-2 py-2">
                    <div className="flex items-center gap-2">
                      <div className="h-3 w-1 shrink-0" style={{ backgroundColor: modelColor }} />
                      <div
                        className="max-w-[150px] truncate font-mono text-[length:var(--fs-sm)] text-(--fg) sm:max-w-[240px]"
                        title={model.model}
                      >
                        {modelDisplayName(model.model)}
                      </div>
                    </div>
                  </TCell>
                  <TCell align="right" className="px-2 py-2">
                    <MetricMeter
                      value={formatNumber(model.requests)}
                      percent={ratio(model.requests, scale.requests)}
                    />
                  </TCell>
                  <TCell align="right" className="px-2 py-2">
                    <MetricMeter
                      value={formatNumber(model.total_tokens)}
                      percent={ratio(model.total_tokens, scale.tokens)}
                    />
                  </TCell>
                  <TCell align="right" className="px-2 py-2">
                    <MetricMeter
                      value={formatDurationOrUnavailable(model.avg_latency_ms)}
                      percent={ratio(model.avg_latency_ms, scale.latency)}
                      tone="bad"
                    />
                  </TCell>
                  <TCell align="right" className="px-2 py-2">
                    <MetricMeter
                      value={formatDurationOrUnavailable(model.avg_ttft_ms)}
                      percent={ratio(model.avg_ttft_ms, scale.ttft)}
                      tone="bad"
                    />
                  </TCell>
                  <TCell align="right" className="px-2 py-2 font-mono">
                    {renderSpeedDisplay(resolveSpeedDisplay(model, peak))}
                  </TCell>
                  <TCell align="right" className="px-2 py-2 font-mono tabular-nums text-(--dim)">
                    {model.cache_hit_rate.toFixed(1)}%
                  </TCell>
                </TRow>
                {isExpanded ? (
                  <TRow className="border-b border-(--border)/25 hover:bg-transparent">
                    <TCell colSpan={8} className="px-2 py-3">
                      <ExpandedModel model={model} peak={peak} modelColor={modelColor} />
                    </TCell>
                  </TRow>
                ) : null}
              </Fragment>
            );
          })}
        </TBody>
      </Table>
    </section>
  );
}

function ExpandedModel({
  model,
  peak,
  modelColor,
}: {
  model: ModelData;
  peak: PeakMetrics | undefined;
  modelColor: string;
}) {
  const tokenTotal = Math.max(model.prompt_tokens + model.completion_tokens, 1);
  const latencyMax = Math.max(
    model.avg_latency_ms ?? 0,
    model.p50_latency_ms ?? 0,
    peak?.ttft_ms ?? 0,
    1,
  );
  return (
    <div className="grid gap-4 border-y border-(--border)/40 py-3 lg:grid-cols-[1.2fr_1fr_1fr]">
      <MetricPanel title="Token mix" value={formatNumber(model.total_tokens)}>
        <StackedMetricBar
          segments={[
            { label: "prompt", value: model.prompt_tokens, color: modelColor },
            { label: "completion", value: model.completion_tokens, color: "var(--hl2)" },
          ]}
          total={tokenTotal}
          formatValue={formatNumber}
        />
      </MetricPanel>
      <MetricPanel title="Latency" value={formatDurationOrUnavailable(model.avg_latency_ms)}>
        <MiniBarChart
          bars={[
            { label: "avg", value: model.avg_latency_ms ?? 0 },
            { label: "p50", value: model.p50_latency_ms ?? 0 },
            { label: "ttft", value: model.avg_ttft_ms ?? 0 },
          ]}
          max={latencyMax}
        />
      </MetricPanel>
      <MetricPanel title="Throughput" value={formatNumber(model.avg_tokens)}>
        <MiniBarChart
          bars={[
            { label: "avg/req", value: model.avg_tokens },
            { label: "prefill", value: model.prefill_tps ?? peak?.prefill_tps ?? 0 },
            { label: "gen", value: model.generation_tps ?? peak?.generation_tps ?? 0 },
          ]}
          max={Math.max(
            model.avg_tokens,
            model.prefill_tps ?? 0,
            model.generation_tps ?? 0,
            peak?.prefill_tps ?? 0,
            peak?.generation_tps ?? 0,
            1,
          )}
        />
      </MetricPanel>
    </div>
  );
}

function renderSpeedDisplay(speed: SpeedDisplay) {
  if (speed.kind === "empty") {
    return <span className="text-(--dim)">—</span>;
  }
  if (speed.kind === "single") {
    return <span className="tabular-nums text-(--fg)">{speed.text}</span>;
  }
  return (
    <div
      className={`flex flex-col items-end gap-1 ${speed.muted ? "text-(--dim)" : "text-(--fg)"}`}
    >
      {speed.rows.map((row) => (
        <span key={row} className="tabular-nums text-[length:var(--fs-xs)]">
          {row}
        </span>
      ))}
    </div>
  );
}
