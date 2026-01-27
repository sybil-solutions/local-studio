// CRITICAL
"use client";

import { formatNumber, formatDate } from "@/lib/formatters";
import { getModelColor } from "@/lib/colors";
import { BarChart3, Calendar } from "lucide-react";

interface DailyStat {
  date: string;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  requests: number;
}

interface DailyUsageProps {
  stats: {
    daily: DailyStat[];
    peak_days?: Array<{ tokens: number }>;
  };
  dailyByModel: Map<string, Map<string, { total_tokens: number }>>;
  modelsForChart: string[];
}

interface ModelDataItem {
  model: string;
  tokens: number;
  color: string;
}

export function DailyUsageChart(
  stats: DailyUsageProps["stats"],
  dailyByModel: Map<string, Map<string, { total_tokens: number }>>,
  modelsForChart: string[],
) {
  const chartDates = [...new Set(stats.daily.map((d: DailyStat) => d.date))].sort(
    (a: string, b: string) => new Date(a).getTime() - new Date(b).getTime(),
  );
  const dailyTokens = stats.daily.map((d: DailyStat) => d.total_tokens);
  const maxDailyTokens = Math.max(...dailyTokens, 1);
  const peakTokens = stats.peak_days?.map((d: { tokens: number }) => d.tokens) || [];
  const maxPeakTokens = Math.max(...peakTokens, 1);
  const maxDailyTokensFinal = Math.max(maxDailyTokens, maxPeakTokens, 1);

  const totalTokensInPeriod = stats.daily.reduce((sum, d) => sum + d.total_tokens, 0);
  const totalRequestsInPeriod = stats.daily.reduce((sum, d) => sum + d.requests, 0);
  const avgDailyTokens = Math.round(totalTokensInPeriod / (chartDates.length || 1));

  return (
    <section className="mb-6 sm:mb-8">
      <div className="bg-[#1e1e1e] rounded-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-[#363432]">
          <div className="flex items-center gap-2 text-[#9a9088]">
            <BarChart3 className="h-4 w-4" />
            <span className="text-xs uppercase tracking-wider">Daily Usage</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-[#9a9088]">
            <div className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              <span>{chartDates.length} days</span>
            </div>
            <span className="hidden sm:inline">
              <span className="text-[#f0ebe3] tabular-nums">{formatNumber(avgDailyTokens)}</span> avg/day
            </span>
          </div>
        </div>

        {/* Chart Area */}
        <div className="p-4 sm:p-6">
          <div className="flex items-end gap-1 sm:gap-1.5 h-56 sm:h-64 overflow-x-auto pb-2">
            {chartDates.map((date: string) => {
              const dateData = stats.daily.find((d: DailyStat) => d.date === date);
              const dateTotalTokens = dateData?.total_tokens || 0;

              return (
                <div key={date} className="flex-1 flex flex-col items-center gap-1.5 group min-w-[24px]">
                  <div className="w-full relative" style={{ height: "180px" }}>
                    {(dailyByModel.size > 0 && dateTotalTokens > 0
                      ? (() => {
                          const modelDataForDate: Array<{
                            model: string;
                            tokens: number;
                            color: string;
                          }> = [];

                          for (const model of modelsForChart) {
                            const modelData = dailyByModel.get(model)?.get(date);
                            if (modelData && modelData.total_tokens > 0) {
                              modelDataForDate.push({
                                model,
                                tokens: modelData.total_tokens,
                                color: getModelColor(model),
                              });
                            }
                          }

                          modelDataForDate.sort((a: ModelDataItem, b: ModelDataItem) => b.tokens - a.tokens);

                          if (modelDataForDate.length === 0) {
                            return null;
                          }

                          let cumulativeBottom = 0;
                          return modelDataForDate.map((item: ModelDataItem, idx: number) => {
                            const height = (item.tokens / maxDailyTokensFinal) * 100;
                            const bottom = cumulativeBottom;
                            cumulativeBottom += height;
                            const isTop = idx === 0;
                            const isBottom = idx === modelDataForDate.length - 1;

                            return (
                              <div
                                key={`${date}-${item.model}`}
                                className="absolute w-full left-0 transition-opacity group-hover:opacity-80"
                                style={{
                                  height: `${height}%`,
                                  bottom: `${bottom}%`,
                                  backgroundColor: item.color,
                                  minHeight: height > 0.5 ? "2px" : "0",
                                  borderRadius: isTop
                                    ? "2px 2px 0 0"
                                    : isBottom
                                      ? "0 0 2px 2px"
                                      : "0",
                                }}
                                title={`${item.model}: ${formatNumber(item.tokens)} tokens (${((item.tokens / dateTotalTokens) * 100).toFixed(1)}%)`}
                              />
                            );
                          });
                        })()
                      : (() => {
                          if (!dateData || dateTotalTokens === 0) return null;

                          const completionHeight =
                            (dateData.completion_tokens / maxDailyTokensFinal) * 100;
                          const promptHeight = (dateData.prompt_tokens / maxDailyTokensFinal) * 100;

                          return (
                            <>
                              {completionHeight > 0 && (
                                <div
                                  className="absolute w-full left-0 bg-[#7d9a6a]/60 rounded-t"
                                  style={{
                                    height: `${completionHeight}%`,
                                    bottom: `${promptHeight}%`,
                                    minHeight: completionHeight > 0.5 ? "2px" : "0",
                                  }}
                                  title={`Completion: ${formatNumber(dateData.completion_tokens)} tokens`}
                                />
                              )}
                              {promptHeight > 0 && (
                                <div
                                  className="absolute w-full left-0 bg-[#f0ebe3]/20 rounded-b"
                                  style={{
                                    height: `${promptHeight}%`,
                                    bottom: "0%",
                                    minHeight: promptHeight > 0.5 ? "2px" : "0",
                                  }}
                                  title={`Prompt: ${formatNumber(dateData.prompt_tokens)} tokens`}
                                />
                              )}
                            </>
                          );
                        })())}
                  </div>

                  {/* Date label */}
                  <div className="text-[10px] text-[#9a9088] truncate w-full text-center">
                    {formatDate(date)}
                  </div>

                  {/* Requests count */}
                  <div className="text-[9px] text-[#9a9088]/60 tabular-nums">
                    {dateData?.requests || 0} req
                  </div>
                </div>
              );
            })}
          </div>

          {/* Legend */}
          {dailyByModel.size > 0 && modelsForChart.length > 0 && (
            <div className="mt-4 pt-4 border-t border-[#363432]">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                {modelsForChart.slice(0, 8).map((model: string) => {
                  const hasData = chartDates.some((date: string) => dailyByModel.get(model)?.has(date));
                  if (!hasData) return null;
                  return (
                    <div key={model} className="flex items-center gap-1.5">
                      <div
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{
                          backgroundColor: getModelColor(model),
                        }}
                      />
                      <span className="truncate max-w-[100px] text-[11px] text-[#9a9088]" title={model}>
                        {model.split('/').pop()}
                      </span>
                    </div>
                  );
                })}
                {modelsForChart.length > 8 && (
                  <span className="text-[#9a9088]/60 text-[11px]">
                    +{modelsForChart.length - 8} more
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Summary Stats */}
          <div className="mt-4 pt-4 border-t border-[#363432] grid grid-cols-3 gap-4">
            <div className="text-center">
              <p className="text-[10px] text-[#9a9088] uppercase tracking-wider">Total Tokens</p>
              <p className="text-base font-medium tabular-nums">{formatNumber(totalTokensInPeriod)}</p>
            </div>
            <div className="text-center border-x border-[#363432]">
              <p className="text-[10px] text-[#9a9088] uppercase tracking-wider">Total Requests</p>
              <p className="text-base font-medium tabular-nums">{formatNumber(totalRequestsInPeriod)}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] text-[#9a9088] uppercase tracking-wider">Peak Day</p>
              <p className="text-base font-medium tabular-nums">{formatNumber(maxDailyTokens)}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
