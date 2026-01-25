// CRITICAL
"use client";

import type { PeakMetrics } from "@/lib/types";
import { ChevronDown, ChevronUp } from "lucide-react";
import { formatNumber, formatDuration } from "@/lib/formatters";
import { getModelColor } from "@/lib/colors";

type SortField = "model" | "requests" | "tokens" | "success" | "latency" | "ttft" | "speed";

interface ModelData {
  model: string;
  requests: number;
  total_tokens: number;
  success_rate: number;
  avg_latency_ms: number;
  avg_ttft_ms: number;
  tokens_per_sec: number | null;
  prefill_tps: number | null;
  generation_tps: number | null;
  prompt_tokens: number;
  completion_tokens: number;
  avg_tokens: number;
  p50_latency_ms: number;
}

export function ModelPerformanceTable(
  sortedModels: ModelData[],
  peakMetrics: Map<string, PeakMetrics>,
  expandedRows: Set<string>,
  sortField: SortField,
  sortDirection: "asc" | "desc",
  handleSort: (field: SortField) => void,
  toggleRow: (model: string) => void,
) {
  return (
    <section className="mb-6 pb-5 border-b border-(--border)/40">
      <h2 className="text-xs uppercase tracking-wider text-(--muted-foreground) mb-3 font-medium">
        Model Performance
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-(--muted-foreground) text-xs border-b border-(--border)/40">
              <th className="text-left py-3 px-3 font-normal w-8"></th>
              <th
                className="text-left py-3 px-3 font-normal cursor-pointer hover:text-(--foreground) transition-colors"
                onClick={() => handleSort("model")}
              >
                Model {sortField === "model" && (sortDirection === "asc" ? "↑" : "↓")}
              </th>
              <th
                className="text-right py-3 px-3 font-normal tabular-nums cursor-pointer hover:text-(--foreground) transition-colors"
                onClick={() => handleSort("requests")}
              >
                Requests {sortField === "requests" && (sortDirection === "asc" ? "↑" : "↓")}
              </th>
              <th
                className="text-right py-3 px-3 font-normal tabular-nums cursor-pointer hover:text-(--foreground) transition-colors"
                onClick={() => handleSort("tokens")}
              >
                Tokens {sortField === "tokens" && (sortDirection === "asc" ? "↑" : "↓")}
              </th>
              <th
                className="text-right py-3 px-3 font-normal tabular-nums cursor-pointer hover:text-(--foreground) transition-colors"
                onClick={() => handleSort("success")}
              >
                Success {sortField === "success" && (sortDirection === "asc" ? "↑" : "↓")}
              </th>
              <th
                className="text-right py-3 px-3 font-normal tabular-nums cursor-pointer hover:text-(--foreground) transition-colors"
                onClick={() => handleSort("latency")}
              >
                Latency {sortField === "latency" && (sortDirection === "asc" ? "↑" : "↓")}
              </th>
              <th
                className="text-right py-3 px-3 font-normal tabular-nums cursor-pointer hover:text-(--foreground) transition-colors"
                onClick={() => handleSort("ttft")}
              >
                TTFT {sortField === "ttft" && (sortDirection === "asc" ? "↑" : "↓")}
              </th>
              <th
                className="text-right py-3 px-3 font-normal tabular-nums cursor-pointer hover:text-(--foreground) transition-colors"
                onClick={() => handleSort("speed")}
              >
                Speed {sortField === "speed" && (sortDirection === "asc" ? "↑" : "↓")}
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedModels.map((model, i) => {
              const peak = peakMetrics.get(model.model);
              const isExpanded = expandedRows.has(model.model);
              const modelColor = getModelColor(model.model);

              return (
                <>
                  <tr
                    key={model.model}
                    className={`hover:bg-(--card)/30 transition-colors cursor-pointer ${i > 0 ? "border-t border-(--border)/20" : ""}`}
                    onClick={() => toggleRow(model.model)}
                  >
                    <td className="py-3 px-3">
                      {isExpanded ? (
                        <ChevronDown className="h-3.5 w-3.5 text-(--muted-foreground)" />
                      ) : (
                        <ChevronUp className="h-3.5 w-3.5 text-(--muted-foreground) rotate-[-90deg]" />
                      )}
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: modelColor }}
                        />
                        <div
                          className="text-(--foreground) font-medium truncate max-w-xs"
                          title={model.model}
                        >
                          {model.model}
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-3 text-right tabular-nums text-(--foreground)">
                      {formatNumber(model.requests)}
                    </td>
                    <td className="py-3 px-3 text-right tabular-nums text-(--foreground)">
                      {formatNumber(model.total_tokens)}
                    </td>
                    <td className="py-3 px-3 text-right">
                      <span
                        className={`tabular-nums ${
                          model.success_rate >= 95
                            ? "text-(--success)"
                            : model.success_rate >= 90
                              ? "text-(--warning)"
                              : "text-(--error)"
                        }`}
                      >
                        {model.success_rate.toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right tabular-nums text-(--foreground)">
                      {formatDuration(model.avg_latency_ms)}
                    </td>
                    <td className="py-3 px-3 text-right tabular-nums text-(--foreground)">
                      {formatDuration(model.avg_ttft_ms)}
                    </td>
                    <td className="py-3 px-3 text-right">
                      {model.prefill_tps || model.generation_tps ? (
                        <div className="flex flex-col items-end gap-0.5">
                          {model.prefill_tps && (
                            <span className="tabular-nums text-(--foreground) text-xs">
                              {model.prefill_tps.toFixed(1)} prefill
                            </span>
                          )}
                          {model.generation_tps && (
                            <span className="tabular-nums text-(--foreground) text-xs">
                              {model.generation_tps.toFixed(1)} gen
                            </span>
                          )}
                        </div>
                      ) : model.tokens_per_sec ? (
                        <span className="tabular-nums text-(--foreground)">
                          {model.tokens_per_sec.toFixed(1)} tok/s
                        </span>
                      ) : peak?.generation_tps || peak?.prefill_tps ? (
                        <div className="flex flex-col items-end gap-0.5">
                          {peak.prefill_tps && (
                            <span className="tabular-nums text-(--muted-foreground) text-xs">
                              peak {peak.prefill_tps.toFixed(1)} prefill
                            </span>
                          )}
                          {peak.generation_tps && (
                            <span className="tabular-nums text-(--muted-foreground) text-xs">
                              peak {peak.generation_tps.toFixed(1)} gen
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-(--muted-foreground)">—</span>
                      )}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="bg-(--card)/20">
                      <td colSpan={8} className="py-4 px-3">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                          <div>
                            <div className="text-xs text-(--muted-foreground) mb-1">
                              Prompt Tokens
                            </div>
                            <div className="text-(--foreground) tabular-nums">
                              {formatNumber(model.prompt_tokens)}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs text-(--muted-foreground) mb-1">
                              Completion Tokens
                            </div>
                            <div className="text-(--foreground) tabular-nums">
                              {formatNumber(model.completion_tokens)}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs text-(--muted-foreground) mb-1">
                              Avg Tokens/Req
                            </div>
                            <div className="text-(--foreground) tabular-nums">
                              {formatNumber(model.avg_tokens)}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs text-(--muted-foreground) mb-1">
                              P50 Latency
                            </div>
                            <div className="text-(--foreground) tabular-nums">
                              {formatDuration(model.p50_latency_ms)}
                            </div>
                          </div>
                          {peak && (
                            <>
                              {peak.prefill_tps && (
                                <div>
                                  <div className="text-xs text-(--muted-foreground) mb-1">
                                    Peak Prefill
                                  </div>
                                  <div className="text-(--foreground) tabular-nums">
                                    {peak.prefill_tps.toFixed(1)} tok/s
                                  </div>
                                </div>
                              )}
                              {peak.generation_tps && (
                                <div>
                                  <div className="text-xs text-(--muted-foreground) mb-1">
                                    Peak Generation
                                  </div>
                                  <div className="text-(--foreground) tabular-nums">
                                    {peak.generation_tps.toFixed(1)} tok/s
                                  </div>
                                </div>
                              )}
                              {peak.ttft_ms && (
                                <div>
                                  <div className="text-xs text-(--muted-foreground) mb-1">
                                    Best TTFT
                                  </div>
                                  <div className="text-(--foreground) tabular-nums">
                                    {Math.round(peak.ttft_ms)}ms
                                  </div>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
