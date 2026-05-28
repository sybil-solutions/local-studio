"use client";

import type { PeakMetrics, SortDirection, SortField } from "@/lib/types";
import { Fragment } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { formatNumber, formatDurationOrUnavailable } from "@/lib/formatters";
import { getModelColor } from "@/lib/colors";
import {
  modelDisplayName,
  resolveSpeedDisplay,
  type ModelData,
  type SpeedDisplay,
} from "./model-performance-table-model";
import { SortHeader, StatusPill } from "./model-performance-table/components";

interface ModelPerformanceTableProps {
  sortedModels: ModelData[];
  peakMetrics: Map<string, PeakMetrics>;
  expandedRows: Set<string>;
  sortField: SortField;
  sortDirection: SortDirection;
  handleSort: (field: SortField) => void;
  toggleRow: (model: string) => void;
}

export function ModelPerformanceTable({
  expandedRows,
  handleSort,
  peakMetrics,
  sortDirection,
  sortField,
  sortedModels,
  toggleRow,
}: ModelPerformanceTableProps) {
  return (
    <section className="px-2 pt-2 pb-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="font-mono text-[9.5px] font-medium uppercase tracking-[0.18em] text-(--dim)/75">
          Model performance
        </div>
        <div className="font-mono text-[10.5px] text-(--dim)">
          <span className="tabular-nums text-(--fg)">{sortedModels.length}</span> models
        </div>
      </div>

      <div className="overflow-x-auto border-b border-(--border)/40">
        <table className="w-full text-left text-[12px]">
          <thead>
            <tr className="border-b border-(--border)/40">
              <th className="w-6 px-2 py-2" />
              <SortHeader
                field="model"
                currentField={sortField}
                direction={sortDirection}
                onClick={() => handleSort("model")}
              >
                Model
              </SortHeader>
              <SortHeader
                field="requests"
                currentField={sortField}
                direction={sortDirection}
                onClick={() => handleSort("requests")}
                align="right"
              >
                Requests
              </SortHeader>
              <SortHeader
                field="tokens"
                currentField={sortField}
                direction={sortDirection}
                onClick={() => handleSort("tokens")}
                align="right"
              >
                Tokens
              </SortHeader>
              <SortHeader
                field="success"
                currentField={sortField}
                direction={sortDirection}
                onClick={() => handleSort("success")}
                align="right"
              >
                Success
              </SortHeader>
              <SortHeader
                field="latency"
                currentField={sortField}
                direction={sortDirection}
                onClick={() => handleSort("latency")}
                align="right"
              >
                Latency
              </SortHeader>
              <SortHeader
                field="ttft"
                currentField={sortField}
                direction={sortDirection}
                onClick={() => handleSort("ttft")}
                align="right"
              >
                TTFT
              </SortHeader>
              <SortHeader
                field="speed"
                currentField={sortField}
                direction={sortDirection}
                onClick={() => handleSort("speed")}
                align="right"
              >
                Speed
              </SortHeader>
            </tr>
          </thead>
          <tbody>
            {sortedModels.map((model) => {
              const peak = peakMetrics.get(model.model);
              const isExpanded = expandedRows.has(model.model);
              const modelColor = getModelColor(model.model);

              return (
                <Fragment key={model.model}>
                  <tr
                    className={`cursor-pointer border-b border-(--border)/25 transition-colors hover:bg-(--hover) ${
                      isExpanded ? "bg-(--hover)" : ""
                    }`}
                    onClick={() => toggleRow(model.model)}
                  >
                    <td className="px-2 py-2">
                      {isExpanded ? (
                        <ChevronDown className="h-3 w-3 text-(--dim)" />
                      ) : (
                        <ChevronUp className="h-3 w-3 rotate-[-90deg] text-(--dim)" />
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-3 w-1 shrink-0" style={{ backgroundColor: modelColor }} />
                        <div
                          className="max-w-[150px] truncate font-mono text-[11.5px] text-(--fg) sm:max-w-[240px]"
                          title={model.model}
                        >
                          {modelDisplayName(model.model)}
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums text-(--dim)">
                      {formatNumber(model.requests)}
                    </td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums text-(--dim)">
                      {formatNumber(model.total_tokens)}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <StatusPill value={model.success_rate} type="success" />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <StatusPill value={model.avg_latency_ms} type="latency" />
                    </td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums text-(--dim)">
                      {formatDurationOrUnavailable(model.avg_ttft_ms)}
                    </td>
                    <td className="px-2 py-2 text-right font-mono">
                      {renderSpeedDisplay(resolveSpeedDisplay(model, peak))}
                    </td>
                  </tr>
                  {isExpanded ? (
                    <tr className="border-b border-(--border)/25">
                      <td colSpan={8} className="px-2 py-3">
                        <dl className="grid grid-cols-2 border-y border-(--border)/40 py-3 sm:grid-cols-4">
                          <ExpandedCell
                            label="prompt tokens"
                            value={formatNumber(model.prompt_tokens)}
                          />
                          <ExpandedCell
                            label="completion tokens"
                            value={formatNumber(model.completion_tokens)}
                          />
                          <ExpandedCell
                            label="avg tokens/req"
                            value={formatNumber(model.avg_tokens)}
                          />
                          <ExpandedCell
                            label="p50 latency"
                            value={formatDurationOrUnavailable(model.p50_latency_ms)}
                          />
                          {peak?.prefill_tps ? (
                            <ExpandedCell
                              label="peak prefill"
                              value={`${peak.prefill_tps.toFixed(1)} t/s`}
                            />
                          ) : null}
                          {peak?.generation_tps ? (
                            <ExpandedCell
                              label="peak generation"
                              value={`${peak.generation_tps.toFixed(1)} t/s`}
                            />
                          ) : null}
                          {peak?.ttft_ms ? (
                            <ExpandedCell
                              label="best ttft"
                              value={`${Math.round(peak.ttft_ms)} ms`}
                            />
                          ) : null}
                          {peak?.best_session_prefill_tps ? (
                            <ExpandedCell
                              label="session max prefill"
                              value={`${peak.best_session_prefill_tps.toFixed(1)} t/s`}
                            />
                          ) : null}
                          {peak?.best_session_generation_tps ? (
                            <ExpandedCell
                              label="session max generation"
                              value={`${peak.best_session_generation_tps.toFixed(1)} t/s`}
                            />
                          ) : null}
                        </dl>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ExpandedCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border-r border-(--border)/40 pr-2 pl-3 first:pl-0 last:border-r-0 sm:pr-4 sm:pl-5">
      <dt className="truncate font-mono text-[9.5px] font-medium uppercase tracking-[0.18em] text-(--dim)/75">
        {label}
      </dt>
      <dd className="mt-1 font-mono text-[13px] leading-none tabular-nums text-(--fg)">{value}</dd>
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
    <div className={`flex flex-col items-end gap-0.5 ${speed.muted ? "text-(--dim)" : ""}`}>
      {speed.rows.map((row) => (
        <span key={row} className="tabular-nums text-[11px]">
          {row}
        </span>
      ))}
    </div>
  );
}
