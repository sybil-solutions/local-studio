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

  const totalTokensInPeriod = stats.daily.reduce((sum, d) => sum + d.total_tokens, 0);
  const totalRequestsInPeriod = stats.daily.reduce((sum, d) => sum + d.requests, 0);
  const avgDailyTokens = Math.round(totalTokensInPeriod / (chartDates.length || 1));

  return (
    <section className="px-2 pt-2 pb-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="font-mono text-[9.5px] font-medium uppercase tracking-[0.18em] text-(--dim)/75">
          Daily usage
        </div>
        <div className="flex items-center gap-3 font-mono text-[10.5px] text-(--dim)">
          <span>{chartDates.length} days</span>
          <span className="text-(--border)">·</span>
          <span>
            <span className="tabular-nums text-(--fg)">{formatNumber(avgDailyTokens)}</span> avg/day
          </span>
        </div>
      </div>

      <div className="flex h-44 items-end gap-1 overflow-x-auto border-b border-(--border)/40 pb-3 sm:h-52 sm:gap-1.5">
        {chartDates.map((date: string) => {
          const dateData = stats.daily.find((d: DailyStat) => d.date === date);
          const dateTotalTokens = dateData?.total_tokens || 0;

          return (
            <div
              key={date}
              className="group flex min-w-[24px] flex-1 flex-col items-center gap-1.5"
            >
              <div className="relative w-full" style={{ height: "140px" }}>
                {dailyByModel.size > 0 && dateTotalTokens > 0
                  ? (() => {
                      const modelDataForDate: ModelDataItem[] = [];
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
                      modelDataForDate.sort((a, b) => b.tokens - a.tokens);
                      if (modelDataForDate.length === 0) return null;
                      let cumulativeBottom = 0;
                      return modelDataForDate.map((item: ModelDataItem) => {
                        const height = (item.tokens / maxDailyTokensFinal) * 100;
                        const bottom = cumulativeBottom;
                        cumulativeBottom += height;
                        return (
                          <div
                            key={`${date}-${item.model}`}
                            className="absolute left-0 w-full transition-opacity group-hover:opacity-80"
                            style={{
                              height: `${height}%`,
                              bottom: `${bottom}%`,
                              backgroundColor: item.color,
                              minHeight: height > 0.5 ? "2px" : "0",
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
                              className="absolute left-0 w-full bg-(--hl2)/60"
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
                              className="absolute left-0 w-full bg-(--fg)/20"
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
                    })()}
              </div>
              <div className="w-full truncate text-center font-mono text-[10px] text-(--dim)">
                {formatDate(date)}
              </div>
              <div className="font-mono text-[9px] tabular-nums text-(--dim)/60">
                {dateData?.requests || 0} req
              </div>
            </div>
          );
        })}
      </div>

      {dailyByModel.size > 0 && modelsForChart.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {modelsForChart.slice(0, 8).map((model: string) => {
            const hasData = chartDates.some((date: string) => dailyByModel.get(model)?.has(date));
            if (!hasData) return null;
            return (
              <div key={model} className="flex items-center gap-1.5">
                <div
                  className="h-2 w-2 shrink-0"
                  style={{ backgroundColor: getModelColor(model) }}
                />
                <span
                  className="max-w-[120px] truncate font-mono text-[10.5px] text-(--dim)"
                  title={model}
                >
                  {model.split("/").pop()}
                </span>
              </div>
            );
          })}
          {modelsForChart.length > 8 ? (
            <span className="font-mono text-[10.5px] text-(--dim)/60">
              +{modelsForChart.length - 8} more
            </span>
          ) : null}
        </div>
      ) : null}

      <dl className="mt-4 grid grid-cols-3 border-b border-(--border)/40 pb-4">
        <Stat label="total tokens" value={formatNumber(totalTokensInPeriod)} />
        <Stat label="total requests" value={formatNumber(totalRequestsInPeriod)} />
        <Stat label="peak day" value={formatNumber(maxDailyTokens)} />
      </dl>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border-r border-(--border)/40 pr-2 pl-3 first:pl-0 last:border-r-0 sm:pr-4 sm:pl-5">
      <dt className="truncate font-mono text-[9.5px] font-medium uppercase tracking-[0.18em] text-(--dim)/75">
        {label}
      </dt>
      <dd className="mt-1 font-mono text-[16px] leading-none tabular-nums text-(--fg)">{value}</dd>
    </div>
  );
}
