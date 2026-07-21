"use client";

import { useState } from "react";
import { formatNumber } from "@/lib/formatters";
import type { UsageStats } from "@/lib/types";

const DAY_MS = 86_400_000;
const WEEKS = 53;
const LEVEL_CLASSES = [
  "bg-(--ui-surface-2)",
  "bg-[color:var(--color-blue-500)]/20",
  "bg-[color:var(--color-blue-500)]/38",
  "bg-[color:var(--color-blue-500)]/62",
  "bg-[color:var(--color-blue-500)]/90",
];

type DailyUsage = UsageStats["daily"][number];
type ActivityUsage = Pick<DailyUsage, "requests" | "total_tokens">;

export type ActivityPeriod = "daily" | "weekly";

const startOfUtcDay = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

const calendarStart = (end: Date): Date => {
  const currentWeek = new Date(end.getTime() - end.getUTCDay() * DAY_MS);
  return new Date(currentWeek.getTime() - (WEEKS - 1) * 7 * DAY_MS);
};

const dateKey = (date: Date): string => date.toISOString().slice(0, 10);

const dateLabel = (date: Date): string =>
  date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

const weekLabel = (date: Date): string => {
  const end = new Date(date.getTime() + 6 * DAY_MS);
  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${formatter.format(date)} – ${formatter.format(end)}`;
};

const quantile = (values: number[], fraction: number): number =>
  values[Math.min(values.length - 1, Math.floor(values.length * fraction))] ?? 0;

const thresholds = (daily: ActivityUsage[]): number[] => {
  const values = daily
    .map((day) => day.total_tokens)
    .filter((value) => value > 0)
    .sort((a, b) => a - b);
  return [quantile(values, 0.25), quantile(values, 0.5), quantile(values, 0.75)];
};

const activityLevel = (value: number, limits: number[]): number => {
  if (value <= 0) return 0;
  if (value <= (limits[0] ?? 0)) return 1;
  if (value <= (limits[1] ?? 0)) return 2;
  if (value <= (limits[2] ?? 0)) return 3;
  return 4;
};

const monthLabels = (start: Date): Array<string | null> =>
  Array.from({ length: WEEKS }, (_, week) => {
    const date = new Date(start.getTime() + week * 7 * DAY_MS);
    const previous = new Date(date.getTime() - 7 * DAY_MS);
    if (week > 0 && date.getUTCMonth() === previous.getUTCMonth()) return null;
    return date.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  });

const weeklyUsage = (daily: DailyUsage[]): Map<string, ActivityUsage> => {
  const weekly = new Map<string, ActivityUsage>();
  for (const day of daily) {
    const date = new Date(`${day.date}T00:00:00.000Z`);
    const week = new Date(date.getTime() - date.getUTCDay() * DAY_MS);
    const key = dateKey(week);
    const existing = weekly.get(key) ?? { requests: 0, total_tokens: 0 };
    weekly.set(key, {
      requests: existing.requests + day.requests,
      total_tokens: existing.total_tokens + day.total_tokens,
    });
  }
  return weekly;
};

export function TokenActivityHeatmap({
  daily,
  period = "daily",
}: {
  daily: DailyUsage[];
  period?: ActivityPeriod;
}) {
  const end = startOfUtcDay(new Date());
  const start = calendarStart(end);
  const byDate =
    period === "daily" ? new Map(daily.map((day) => [day.date, day])) : weeklyUsage(daily);
  const values = Array.from(byDate.values());
  const limits = thresholds(values);
  const cellCount = period === "daily" ? WEEKS * 7 : WEEKS;
  const interval = period === "daily" ? DAY_MS : 7 * DAY_MS;
  const cells = Array.from({ length: cellCount }, (_, index) => {
    const date = new Date(start.getTime() + index * interval);
    const usage = byDate.get(dateKey(date));
    return { date, usage, level: activityLevel(usage?.total_tokens ?? 0, limits) };
  });
  const [activeDate, setActiveDate] = useState(dateKey(end));
  const activeCell = cells.find(({ date }) => dateKey(date) === activeDate) ?? cells.at(-1);

  return (
    <div className="overflow-x-auto pb-1">
      <div className="min-w-[47rem]">
        <div className="mb-2 grid grid-cols-[repeat(53,minmax(0,1fr))] gap-[3px]">
          {monthLabels(start).map((label, index) => (
            <span key={index} className="text-[length:var(--fs-2xs)] text-(--ui-muted)">
              {label}
            </span>
          ))}
        </div>
        <div
          className={
            period === "daily"
              ? "grid grid-flow-col grid-cols-[repeat(53,minmax(0,1fr))] grid-rows-7 gap-[3px]"
              : "grid grid-cols-[repeat(53,minmax(0,1fr))] gap-[3px]"
          }
          aria-label={`${period === "daily" ? "Daily" : "Weekly"} token activity for the past year`}
        >
          {cells.map(({ date, usage, level }) => (
            <button
              key={dateKey(date)}
              type="button"
              onFocus={() => setActiveDate(dateKey(date))}
              onMouseEnter={() => setActiveDate(dateKey(date))}
              aria-label={`${period === "daily" ? dateLabel(date) : weekLabel(date)}: ${formatNumber(usage?.total_tokens ?? 0)} tokens, ${formatNumber(usage?.requests ?? 0)} requests`}
              className={`aspect-square min-h-2.5 rounded-[2px] outline-none ring-(--link) transition-[transform,box-shadow] hover:scale-125 hover:ring-1 focus-visible:scale-125 focus-visible:ring-2 ${LEVEL_CLASSES[level]}`}
            />
          ))}
        </div>
        <div className="mt-3 flex min-h-5 items-center justify-between gap-5 text-[length:var(--fs-2xs)] text-(--ui-muted)">
          <span className="tabular-nums text-(--ui-fg)/85">
            {activeCell
              ? `${period === "daily" ? dateLabel(activeCell.date) : weekLabel(activeCell.date)} · ${formatNumber(activeCell.usage?.total_tokens ?? 0)} tokens · ${formatNumber(activeCell.usage?.requests ?? 0)} requests`
              : null}
          </span>
          <div className="flex shrink-0 items-center gap-1.5">
            <span>Less</span>
            {LEVEL_CLASSES.map((className, index) => (
              <span key={index} className={`h-2.5 w-2.5 rounded-[2px] ${className}`} />
            ))}
            <span>More</span>
          </div>
        </div>
      </div>
    </div>
  );
}
