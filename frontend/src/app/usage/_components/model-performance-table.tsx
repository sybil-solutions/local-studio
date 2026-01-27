// CRITICAL
"use client";

import type { PeakMetrics } from "@/lib/types";
import { ChevronDown, ChevronUp, ArrowUpDown } from "lucide-react";
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

function SortHeader({
  field,
  currentField,
  direction,
  onClick,
  children,
  align = "left",
}: {
  field: SortField;
  currentField: SortField;
  direction: "asc" | "desc";
  onClick: () => void;
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  const isActive = currentField === field;

  return (
    <th
      className={`py-3 px-3 sm:px-4 text-xs text-[#9a9088] font-normal cursor-pointer hover:text-[#f0ebe3] transition-colors select-none ${
        align === "right" ? "text-right" : "text-left"
      }`}
      onClick={onClick}
    >
      <div className={`flex items-center gap-1 ${align === "right" ? "justify-end" : ""}`}>
        {children}
        {isActive && (
          <span>{direction === "asc" ? "↑" : "↓"}</span>
        )}
      </div>
    </th>
  );
}

function StatusPill({ value, type }: { value: number; type: "success" | "latency" }) {
  const getColor = () => {
    if (type === "success") {
      if (value >= 95) return "text-[#7d9a6a]";
      if (value >= 90) return "text-[#c9a66b]";
      return "text-[#c97a6b]";
    }
    if (value < 500) return "text-[#7d9a6a]";
    if (value < 1500) return "text-[#c9a66b]";
    return "text-[#c97a6b]";
  };

  return (
    <span className={`text-sm tabular-nums ${getColor()}`}>
      {type === "success" ? `${value.toFixed(1)}%` : formatDuration(value)}
    </span>
  );
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
    <section className="mb-6 sm:mb-8">
      <div className="bg-[#1e1e1e] rounded-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-[#363432]">
          <div className="text-xs text-[#9a9088] uppercase tracking-wider">
            Model Performance
          </div>
          <div className="text-xs text-[#9a9088]">
            {sortedModels.length} models
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#363432]/50">
                <th className="py-3 px-3 sm:px-4 w-8"></th>
                <SortHeader field="model" currentField={sortField} direction={sortDirection} onClick={() => handleSort("model")}>
                  Model
                </SortHeader>
                <SortHeader field="requests" currentField={sortField} direction={sortDirection} onClick={() => handleSort("requests")} align="right">
                  Requests
                </SortHeader>
                <SortHeader field="tokens" currentField={sortField} direction={sortDirection} onClick={() => handleSort("tokens")} align="right">
                  Tokens
                </SortHeader>
                <SortHeader field="success" currentField={sortField} direction={sortDirection} onClick={() => handleSort("success")} align="right">
                  Success
                </SortHeader>
                <SortHeader field="latency" currentField={sortField} direction={sortDirection} onClick={() => handleSort("latency")} align="right">
                  Latency
                </SortHeader>
                <SortHeader field="ttft" currentField={sortField} direction={sortDirection} onClick={() => handleSort("ttft")} align="right">
                  TTFT
                </SortHeader>
                <SortHeader field="speed" currentField={sortField} direction={sortDirection} onClick={() => handleSort("speed")} align="right">
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
                  <>
                    <tr
                      key={model.model}
                      className={`cursor-pointer hover:bg-[#363432]/30 transition-colors ${
                        i > 0 ? "border-t border-[#363432]/30" : ""
                      } ${isExpanded ? "bg-[#363432]/20" : ""}`}
                      onClick={() => toggleRow(model.model)}
                    >
                      <td className="py-3 px-3 sm:px-4">
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 text-[#9a9088]" />
                        ) : (
                          <ChevronUp className="h-4 w-4 text-[#9a9088] rotate-[-90deg]" />
                        )}
                      </td>
                      <td className="py-3 px-3 sm:px-4">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: modelColor }}
                          />
                          <div
                            className="text-[#f0ebe3] truncate max-w-[150px] sm:max-w-[200px]"
                            title={model.model}
                          >
                            {model.model.split('/').pop()}
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
                      <td className="py-3 px-3 sm:px-4 text-right tabular-nums text-[#9a9088]">
                        {formatDuration(model.avg_ttft_ms)}
                      </td>
                      <td className="py-3 px-3 sm:px-4 text-right">
                        {model.prefill_tps || model.generation_tps ? (
                          <div className="flex flex-col items-end gap-0.5">
                            {model.prefill_tps && (
                              <span className="tabular-nums text-xs">
                                {model.prefill_tps.toFixed(0)} prefill
                              </span>
                            )}
                            {model.generation_tps && (
                              <span className="tabular-nums text-xs">
                                {model.generation_tps.toFixed(0)} gen
                              </span>
                            )}
                          </div>
                        ) : model.tokens_per_sec ? (
                          <span className="tabular-nums">{model.tokens_per_sec.toFixed(0)} tok/s</span>
                        ) : peak?.generation_tps || peak?.prefill_tps ? (
                          <div className="flex flex-col items-end gap-0.5 text-[#9a9088]">
                            {peak.prefill_tps && (
                              <span className="tabular-nums text-xs">
                                peak {peak.prefill_tps.toFixed(0)} prefill
                              </span>
                            )}
                            {peak.generation_tps && (
                              <span className="tabular-nums text-xs">
                                peak {peak.generation_tps.toFixed(0)} gen
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-[#9a9088]">—</span>
                        )}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-[#363432]/10">
                        <td colSpan={8} className="py-4 px-3 sm:px-4">
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                            <div>
                              <div className="text-xs text-[#9a9088] mb-1">Prompt Tokens</div>
                              <div className="tabular-nums">{formatNumber(model.prompt_tokens)}</div>
                            </div>
                            <div>
                              <div className="text-xs text-[#9a9088] mb-1">Completion Tokens</div>
                              <div className="tabular-nums">{formatNumber(model.completion_tokens)}</div>
                            </div>
                            <div>
                              <div className="text-xs text-[#9a9088] mb-1">Avg Tokens/Req</div>
                              <div className="tabular-nums">{formatNumber(model.avg_tokens)}</div>
                            </div>
                            <div>
                              <div className="text-xs text-[#9a9088] mb-1">P50 Latency</div>
                              <div className="tabular-nums">{formatDuration(model.p50_latency_ms)}</div>
                            </div>
                            {peak && (
                              <>
                                {peak.prefill_tps && (
                                  <div>
                                    <div className="text-xs text-[#9a9088] mb-1">Peak Prefill</div>
                                    <div className="tabular-nums">{peak.prefill_tps.toFixed(1)} tok/s</div>
                                  </div>
                                )}
                                {peak.generation_tps && (
                                  <div>
                                    <div className="text-xs text-[#9a9088] mb-1">Peak Generation</div>
                                    <div className="tabular-nums">{peak.generation_tps.toFixed(1)} tok/s</div>
                                  </div>
                                )}
                                {peak.ttft_ms && (
                                  <div>
                                    <div className="text-xs text-[#9a9088] mb-1">Best TTFT</div>
                                    <div className="tabular-nums">{Math.round(peak.ttft_ms)}ms</div>
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
      </div>
    </section>
  );
}
