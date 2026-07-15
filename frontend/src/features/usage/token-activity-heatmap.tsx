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

const quantile = (values: number[], fraction: number): number =>
  values[Math.min(values.length - 1, Math.floor(values.length * fraction))] ?? 0;

const thresholds = (daily: DailyUsage[]): number[] => {
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

export function TokenActivityHeatmap({ daily }: { daily: DailyUsage[] }) {
  const end = startOfUtcDay(new Date());
  const start = calendarStart(end);
  const byDate = new Map(daily.map((day) => [day.date, day]));
  const limits = thresholds(daily);
  const cells = Array.from({ length: WEEKS * 7 }, (_, index) => {
    const date = new Date(start.getTime() + index * DAY_MS);
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
          className="grid grid-flow-col grid-cols-[repeat(53,minmax(0,1fr))] grid-rows-7 gap-[3px]"
          aria-label="Daily token activity for the past year"
        >
          {cells.map(({ date, usage, level }) => (
            <button
              key={dateKey(date)}
              type="button"
              onFocus={() => setActiveDate(dateKey(date))}
              onMouseEnter={() => setActiveDate(dateKey(date))}
              aria-label={`${dateLabel(date)}: ${formatNumber(usage?.total_tokens ?? 0)} tokens, ${formatNumber(usage?.requests ?? 0)} requests`}
              className={`aspect-square min-h-2.5 rounded-[2px] outline-none ring-(--link) transition-[transform,box-shadow] hover:scale-125 hover:ring-1 focus-visible:scale-125 focus-visible:ring-2 ${LEVEL_CLASSES[level]}`}
            />
          ))}
        </div>
        <div className="mt-3 flex min-h-5 items-center justify-between gap-5 text-[length:var(--fs-2xs)] text-(--ui-muted)">
          <span className="tabular-nums text-(--ui-fg)/85">
            {activeCell
              ? `${dateLabel(activeCell.date)} · ${formatNumber(activeCell.usage?.total_tokens ?? 0)} tokens · ${formatNumber(activeCell.usage?.requests ?? 0)} requests`
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
