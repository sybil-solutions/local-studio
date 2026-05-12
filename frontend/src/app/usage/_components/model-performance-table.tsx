// CRITICAL
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
    <section className="mb-6 sm:mb-8">
      <div className="border border-(--border) bg-(--surface) overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-(--border) bg-(--bg)/55 px-4 py-4 sm:px-6">
          <div className="font-mono text-sm uppercase tracking-[0.3em] text-(--dim)">
            Model Performance
          </div>
          <div className="font-mono text-xs uppercase tracking-[0.18em] text-(--dim)">
            {sortedModels.length} models
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-(--border)">
                <th className="py-3 px-3 sm:px-4 w-8"></th>
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
              {sortedModels.map((model, i) => {
                const peak = peakMetrics.get(model.model);
                const isExpanded = expandedRows.has(model.model);
                const modelColor = getModelColor(model.model);

                return (
                  <Fragment key={model.model}>
                    <tr
                      className={`cursor-pointer transition-colors hover:bg-(--fg)/5 ${
                        i > 0 ? "border-t border-(--border)/30" : ""
                      } ${isExpanded ? "bg-(--fg)/8" : ""}`}
                      onClick={() => toggleRow(model.model)}
                    >
                      <td className="py-3 px-3 sm:px-4">
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 text-(--dim)" />
                        ) : (
                          <ChevronUp className="h-4 w-4 text-(--dim) rotate-[-90deg]" />
                        )}
                      </td>
                      <td className="py-3 px-3 sm:px-4">
                        <div className="flex items-center gap-2">
                          <div
                            className="h-3 w-1 shrink-0"
                            style={{ backgroundColor: modelColor }}
                          />
                          <div
                            className="max-w-[150px] truncate font-mono text-(--fg) sm:max-w-[240px]"
                            title={model.model}
                          >
                            {modelDisplayName(model.model)}
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-3 sm:px-4 text-right tabular-nums">
                        {formatNumber(model.requests)}
                      </td>
                      <td className="py-3 px-3 sm:px-4 text-right tabular-nums">
                        {formatNumber(model.total_tokens)}
                      </td>
                      <td className="py-3 px-3 sm:px-4 text-right">
                        <StatusPill value={model.success_rate} type="success" />
                      </td>
                      <td className="py-3 px-3 sm:px-4 text-right">
                        <StatusPill value={model.avg_latency_ms} type="latency" />
                      </td>
                      <td className="py-3 px-3 sm:px-4 text-right tabular-nums text-(--dim)">
                        {formatDurationOrUnavailable(model.avg_ttft_ms)}
                      </td>
                      <td className="py-3 px-3 sm:px-4 text-right">
                        {renderSpeedDisplay(resolveSpeedDisplay(model, peak))}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-(--bg)">
                        <td colSpan={8} className="py-4 px-3 sm:px-4">
                          <div className="grid grid-cols-2 border border-(--border) text-sm sm:grid-cols-4">
                            <div>
                              <div className="border-b border-(--border) px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-(--dim)">
                                Prompt Tokens
                              </div>
                              <div className="px-3 py-3 font-mono tabular-nums">
                                {formatNumber(model.prompt_tokens)}
                              </div>
                            </div>
                            <div className="border-l border-(--border)">
                              <div className="border-b border-(--border) px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-(--dim)">
                                Completion Tokens
                              </div>
                              <div className="px-3 py-3 font-mono tabular-nums">
                                {formatNumber(model.completion_tokens)}
                              </div>
                            </div>
                            <div className="border-l border-(--border)">
                              <div className="border-b border-(--border) px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-(--dim)">
                                Avg Tokens/Req
                              </div>
                              <div className="px-3 py-3 font-mono tabular-nums">
                                {formatNumber(model.avg_tokens)}
                              </div>
                            </div>
                            <div className="border-l border-(--border)">
                              <div className="border-b border-(--border) px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-(--dim)">
                                P50 Latency
                              </div>
                              <div className="px-3 py-3 font-mono tabular-nums">
                                {formatDurationOrUnavailable(model.p50_latency_ms)}
                              </div>
                            </div>
                            {peak && (
                              <>
                                {peak.prefill_tps && (
                                  <div>
                                    <div className="text-xs text-(--dim) mb-1">Peak Prefill</div>
                                    <div className="tabular-nums">
                                      {peak.prefill_tps.toFixed(1)} tok/s
                                    </div>
                                  </div>
                                )}
                                {peak.generation_tps && (
                                  <div>
                                    <div className="text-xs text-(--dim) mb-1">Peak Generation</div>
                                    <div className="tabular-nums">
                                      {peak.generation_tps.toFixed(1)} tok/s
                                    </div>
                                  </div>
                                )}
                                {peak.ttft_ms && (
                                  <div>
                                    <div className="text-xs text-(--dim) mb-1">Best TTFT</div>
                                    <div className="tabular-nums">{Math.round(peak.ttft_ms)}ms</div>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function renderSpeedDisplay(speed: SpeedDisplay) {
  if (speed.kind === "empty") {
    return <span className="text-(--dim)">—</span>;
  }
  if (speed.kind === "single") {
    return <span className="tabular-nums">{speed.text}</span>;
  }
  return (
    <div className={`flex flex-col items-end gap-0.5 ${speed.muted ? "text-(--dim)" : ""}`}>
      {speed.rows.map((row) => (
        <span key={row} className="tabular-nums text-xs">
          {row}
        </span>
      ))}
    </div>
  );
}
