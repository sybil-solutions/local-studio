"use client";

import { useMemo, useRef, useState, type MouseEvent } from "react";
import { formatNumber, formatDate } from "@/lib/formatters";
import { getModelColor } from "@/features/usage/colors";
import { Stat } from "@/ui";

export type UsagePeriod = "day" | "week" | "month" | "year";

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
  modelColorIndex: Map<string, number>;
  period: UsagePeriod;
}

interface ModelDataItem {
  model: string;
  tokens: number;
  color: string;
}

interface HoverState {
  date: string;
  left: number;
  top: number;
  dayTotal: number;
  requests: number;
  items: ModelDataItem[];
}

interface BucketData extends DailyStat {
  key: string;
  label: string;
  shortLabel: string;
  dates: string[];
}

const LEGEND_MAX = 12;

const periodLabel: Record<UsagePeriod, string> = {
  day: "Daily usage",
  week: "Weekly usage",
  month: "Monthly usage",
  year: "Yearly usage",
};

const periodUnit: Record<UsagePeriod, string> = {
  day: "days",
  week: "weeks",
  month: "months",
  year: "years",
};

const averageUnit: Record<UsagePeriod, string> = {
  day: "avg/day",
  week: "avg/week",
  month: "avg/month",
  year: "avg/year",
};

const isoDate = (date: Date): string => date.toISOString().slice(0, 10);

const dateFromIso = (date: string): Date => {
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
};

const weekStart = (date: Date): Date => {
  const next = new Date(date);
  const day = next.getUTCDay();
  next.setUTCDate(next.getUTCDate() - (day === 0 ? 6 : day - 1));
  return next;
};

const bucketKey = (date: string, period: UsagePeriod): string => {
  if (period === "year") return date.slice(0, 4);
  if (period === "month") return date.slice(0, 7);
  if (period === "week") return isoDate(weekStart(dateFromIso(date)));
  return date;
};

const bucketLabel = (key: string, period: UsagePeriod): string => {
  if (period === "year") return key;
  if (period === "month") {
    const parsed = new Date(`${key}-01T00:00:00Z`);
    return parsed.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  }
  if (period === "week") {
    const start = dateFromIso(key);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 6);
    return `${formatDate(isoDate(start))} – ${formatDate(isoDate(end))}`;
  }
  return formatDate(key);
};

const shortBucketLabel = (key: string, period: UsagePeriod): string => {
  if (period === "year") return key;
  if (period === "month") {
    const parsed = new Date(`${key}-01T00:00:00Z`);
    return parsed.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  }
  return formatDate(key);
};

const emptyBucket = (key: string, period: UsagePeriod): BucketData => ({
  key,
  label: bucketLabel(key, period),
  shortLabel: shortBucketLabel(key, period),
  date: key,
  total_tokens: 0,
  prompt_tokens: 0,
  completion_tokens: 0,
  requests: 0,
  dates: [],
});

const periodBuckets = (daily: DailyStat[], period: UsagePeriod): BucketData[] => {
  const buckets = new Map<string, BucketData>();
  for (const day of daily) {
    const key = bucketKey(day.date, period);
    const bucket = buckets.get(key) ?? emptyBucket(key, period);
    bucket.total_tokens += day.total_tokens;
    bucket.prompt_tokens += day.prompt_tokens;
    bucket.completion_tokens += day.completion_tokens;
    bucket.requests += day.requests;
    bucket.dates.push(day.date);
    buckets.set(key, bucket);
  }
  return [...buckets.values()].sort(
    (first, second) => new Date(first.date).getTime() - new Date(second.date).getTime(),
  );
};

export function DailyUsageChart({
  stats,
  dailyByModel,
  modelsForChart,
  modelColorIndex,
  period,
}: DailyUsageProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const [hovered, setHovered] = useState<HoverState | null>(null);

  const colorFor = (model: string): string => getModelColor(modelColorIndex.get(model) ?? 0);

  const chartBuckets = useMemo(() => periodBuckets(stats.daily, period), [period, stats.daily]);
  const maxBucketTokens = Math.max(...chartBuckets.map((bucket) => bucket.total_tokens), 1);
  const peakTokens = stats.peak_days?.map((d: { tokens: number }) => d.tokens) || [];
  const maxPeakTokens = period === "day" ? Math.max(...peakTokens, 1) : 1;
  const maxDailyTokensFinal = Math.max(maxBucketTokens, maxPeakTokens, 1);

  const totalTokensInPeriod = chartBuckets.reduce((sum, bucket) => sum + bucket.total_tokens, 0);
  const totalRequestsInPeriod = chartBuckets.reduce((sum, bucket) => sum + bucket.requests, 0);
  const avgDailyTokens = Math.round(totalTokensInPeriod / (chartBuckets.length || 1));

  // Per-bucket stacked model breakdown. Previously recomputed 2-3x per render
  // (render loop, hover handler, and again inside the bar renderer); memoize it
  // once per (buckets, model map, models, colors) so each bucket is built once.
  const bucketItemsByKey = useMemo(() => {
    const map = new Map<string, ModelDataItem[]>();
    if (dailyByModel.size === 0) return map;
    for (const bucket of chartBuckets) {
      const items: ModelDataItem[] = [];
      for (const model of modelsForChart) {
        const tokens = bucket.dates.reduce(
          (sum, date) => sum + (dailyByModel.get(model)?.get(date)?.total_tokens ?? 0),
          0,
        );
        if (tokens > 0)
          items.push({ model, tokens, color: getModelColor(modelColorIndex.get(model) ?? 0) });
      }
      items.sort((a, b) => b.tokens - a.tokens);
      map.set(bucket.key, items);
    }
    return map;
  }, [chartBuckets, dailyByModel, modelsForChart, modelColorIndex]);

  const handleBarEnter = (event: MouseEvent<HTMLDivElement>, bucket: BucketData) => {
    if (bucket.total_tokens === 0) {
      setHovered(null);
      return;
    }
    const section = sectionRef.current;
    if (!section) return;
    const barRect = event.currentTarget.getBoundingClientRect();
    const sectionRect = section.getBoundingClientRect();
    const items =
      dailyByModel.size > 0
        ? (bucketItemsByKey.get(bucket.key) ?? [])
        : [
            { model: "Completion", tokens: bucket.completion_tokens, color: getModelColor(0) },
            { model: "Prompt", tokens: bucket.prompt_tokens, color: getModelColor(1) },
          ];
    setHovered({
      date: bucket.label,
      left: barRect.left - sectionRect.left + barRect.width / 2,
      top: barRect.top - sectionRect.top,
      dayTotal: bucket.total_tokens,
      requests: bucket.requests,
      items,
    });
  };

  return (
    <section ref={sectionRef} className="relative px-2 pt-2 pb-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="font-mono text-[length:var(--fs-2xs)] font-medium uppercase tracking-[0.18em] text-(--dim)/75">
          {periodLabel[period]}
        </div>
        <div className="flex items-center gap-3 font-mono text-[length:var(--fs-xs)] text-(--dim)">
          <span>
            {chartBuckets.length} {periodUnit[period]}
          </span>
          <span className="text-(--border)">·</span>
          <span>
            <span className="tabular-nums text-(--fg)">{formatNumber(avgDailyTokens)}</span>{" "}
            {averageUnit[period]}
          </span>
        </div>
      </div>

      <div className="overflow-x-auto border-b border-(--border)/40 pb-3">
        <div className="grid min-w-full auto-cols-fr grid-flow-col gap-1 sm:gap-1.5">
          {chartBuckets.map((bucket, index) => {
            const dayItems = dailyByModel.size > 0 ? (bucketItemsByKey.get(bucket.key) ?? []) : [];
            // Thin the axis labels when buckets outnumber the space for them —
            // 48 daily columns can't each carry a date without smearing.
            const labelStride = Math.ceil(chartBuckets.length / 8);
            const showLabel = index % labelStride === 0;

            return (
              <div
                key={bucket.key}
                className="grid min-w-[28px] grid-rows-[140px_1.25rem_2.25rem] items-end justify-items-center gap-1.5 sm:grid-rows-[160px_1.25rem_2.25rem]"
              >
                <div
                  className="relative h-full w-full"
                  onMouseEnter={(event) => handleBarEnter(event, bucket)}
                  onMouseLeave={() => setHovered(null)}
                >
                  {dailyByModel.size > 0 && bucket.total_tokens > 0
                    ? (() => {
                        if (dayItems.length === 0) return null;
                        let cumulativeBottom = 0;
                        return dayItems.map((item: ModelDataItem) => {
                          const height = (item.tokens / maxDailyTokensFinal) * 100;
                          const bottom = cumulativeBottom;
                          cumulativeBottom += height;
                          return (
                            <div
                              key={`${bucket.key}-${item.model}`}
                              className="absolute left-0 w-full"
                              style={{
                                height: `${height}%`,
                                bottom: `${bottom}%`,
                                backgroundColor: item.color,
                                minHeight: height > 0.5 ? "2px" : "0",
                              }}
                            />
                          );
                        });
                      })()
                    : (() => {
                        if (bucket.total_tokens === 0) return null;
                        const completionHeight =
                          (bucket.completion_tokens / maxDailyTokensFinal) * 100;
                        const promptHeight = (bucket.prompt_tokens / maxDailyTokensFinal) * 100;
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
                              />
                            )}
                          </>
                        );
                      })()}
                </div>
                <div
                  className="w-full overflow-visible whitespace-nowrap text-center font-mono text-[length:var(--fs-xs)] text-(--dim)"
                  title={bucket.label}
                >
                  {showLabel ? bucket.shortLabel : null}
                </div>
                <div className="flex h-9 flex-col items-center justify-start font-mono text-[length:var(--fs-2xs)] leading-tight tabular-nums text-(--dim)/60">
                  {showLabel ? (
                    <>
                      <span>{formatNumber(bucket.requests)}</span>
                      <span>req</span>
                    </>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {dailyByModel.size > 0 && modelsForChart.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {modelsForChart.slice(0, LEGEND_MAX).map((model: string) => {
            const hasData = chartBuckets.some((bucket) =>
              bucket.dates.some((date) => dailyByModel.get(model)?.has(date)),
            );
            if (!hasData) return null;
            return (
              <div key={model} className="flex items-center gap-1.5">
                <div className="h-2 w-2 shrink-0" style={{ backgroundColor: colorFor(model) }} />
                <span
                  className="max-w-[120px] truncate font-mono text-[length:var(--fs-xs)] text-(--dim)"
                  title={model}
                >
                  {model.split("/").pop()}
                </span>
              </div>
            );
          })}
          {modelsForChart.length > LEGEND_MAX ? (
            <span className="font-mono text-[length:var(--fs-xs)] text-(--dim)/60">
              +{modelsForChart.length - LEGEND_MAX} more
            </span>
          ) : null}
        </div>
      ) : null}

      <dl className="mt-4 grid grid-cols-2 border-b border-(--border)/40 pb-4">
        <Stat label="tokens in view" value={formatNumber(totalTokensInPeriod)} />
        <Stat label="requests in view" value={formatNumber(totalRequestsInPeriod)} />
      </dl>

      {hovered ? (
        <div
          className="pointer-events-none absolute z-20 min-w-[220px] rounded-md border border-(--border) bg-(--surface-2) shadow-lg"
          style={{
            left: hovered.left,
            top: hovered.top,
            transform: "translate(-50%, calc(-100% - 8px))",
          }}
        >
          <div className="px-3 py-2">
            <div className="flex items-baseline justify-between gap-4 border-b border-(--border)/50 pb-1">
              <span className="font-mono text-[length:var(--fs-2xs)] uppercase tracking-[0.16em] text-(--dim)">
                {hovered.date} · {formatNumber(hovered.requests)} req
              </span>
              <span className="font-mono text-[length:var(--fs-xs)] tabular-nums text-(--fg)">
                {hovered.dayTotal.toLocaleString()}
              </span>
            </div>
            <div className="mt-1.5 space-y-1">
              {hovered.items.map((item: ModelDataItem) => (
                <div key={item.model} className="flex items-center gap-2">
                  <span className="h-2 w-2 shrink-0" style={{ backgroundColor: item.color }} />
                  <span
                    className="truncate font-mono text-[length:var(--fs-xs)] text-(--fg)"
                    title={item.model}
                  >
                    {item.model.split("/").pop()}
                  </span>
                  <span className="ml-auto font-mono text-[length:var(--fs-xs)] tabular-nums text-(--dim)">
                    {item.tokens.toLocaleString()}
                    <span className="ml-1 text-(--dim)/60">
                      {((item.tokens / hovered.dayTotal) * 100).toFixed(1)}%
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
