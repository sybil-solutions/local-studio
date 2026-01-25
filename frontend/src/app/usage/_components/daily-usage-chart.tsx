// CRITICAL
"use client";

import { formatNumber, formatDate } from "@/lib/formatters";
import { getModelColor } from "@/lib/colors";

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

  return (
    <section className="mb-6 pb-5 border-b border-(--border)/40">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs uppercase tracking-wider text-(--muted-foreground) font-medium">
          Daily Usage by Model (Last 14 Days)
        </h2>
        {dailyByModel.size > 0 && (
          <div className="text-[10px] text-(--muted-foreground)">
            {modelsForChart.length} models
          </div>
        )}
      </div>
      <div className="flex items-end gap-1 h-80 overflow-x-auto pb-2">
        {chartDates.map((date: string) => {
          const dateData = stats.daily.find((d: DailyStat) => d.date === date);
          const dateTotalTokens = dateData?.total_tokens || 0;

          return (
            <div key={date} className="flex-1 flex flex-col items-center gap-1 group min-w-0">
              <div className="w-full relative" style={{ height: "288px" }}>
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
                            className="absolute w-full left-0 transition-all group-hover:opacity-90"
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
                              className="absolute w-full left-0 bg-(--success)/40 rounded-t transition-all group-hover:bg-(--success)/60"
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
                              className="absolute w-full left-0 bg-(--foreground)/20 rounded-b transition-all group-hover:bg-(--foreground)/30"
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
              <div className="text-[9px] text-(--muted-foreground) truncate w-full text-center mt-1">
                {formatDate(date)}
              </div>
              <div className="text-[8px] text-(--muted-foreground)/60">
                {dateData?.requests || 0} req
              </div>
            </div>
          );
        })}
      </div>
      {/* Legend */}
      {dailyByModel.size > 0 && modelsForChart.length > 0 && (
        <div className="mt-4 pt-3 border-t border-(--border)/20">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-(--muted-foreground)">
            {modelsForChart.slice(0, 12).map((model: string) => {
              const hasData = chartDates.some((date: string) => dailyByModel.get(model)?.has(date));
              if (!hasData) return null;
              return (
                <div key={model} className="flex items-center gap-1.5">
                  <div
                    className="w-2.5 h-2.5 rounded shrink-0"
                    style={{
                      backgroundColor: getModelColor(model),
                    }}
                  />
                  <span className="truncate max-w-[140px] text-[11px]" title={model}>
                    {model}
                  </span>
                </div>
              );
            })}
            {modelsForChart.length > 12 && (
              <span className="text-(--muted-foreground)/60 text-[11px]">
                +{modelsForChart.length - 12} more
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
