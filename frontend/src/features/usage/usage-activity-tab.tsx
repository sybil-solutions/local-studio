"use client";

import { formatCompactTokens, formatMs, formatNumber } from "@/lib/formatters";
import type { UsageStats } from "@/lib/types";
import {
  DataRow,
  EndCell,
  GroupRow,
  HeadCell,
  LeadCell,
  NumCell,
  StatStrip,
  StatusText,
  TableFrame,
  TableNotice,
  type Stat,
} from "@/features/recipes/recipes-content/catalog-table-shell";
import { UsageBarRow, type UsageBar } from "./usage-bars";
import { useSortedRows } from "./usage-sort";

type DailyRow = UsageStats["daily"][number];
type SortKey = "date" | "requests" | "tokens" | "prompt" | "completion" | "latency" | "success";

const sortValue = (row: DailyRow, key: SortKey): number | string | null => {
  switch (key) {
    case "requests":
      return row.requests;
    case "tokens":
      return row.total_tokens;
    case "prompt":
      return row.prompt_tokens;
    case "completion":
      return row.completion_tokens;
    case "latency":
      return row.avg_latency_ms;
    case "success":
      return row.success_rate;
    default:
      return row.date;
  }
};

const signed = (value: number | null): string =>
  value === null ? "—" : `${value >= 0 ? "+" : ""}${Math.round(value)}%`;

const changeTone = (value: number | null): Stat["tone"] =>
  value === null ? "default" : value > 0 ? "ok" : value < 0 ? "warn" : "default";

const monthLabel = (date: string): string => {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return "Undated";
  return parsed.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
};

const dayLabel = (date: string): string => {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
};

/** Consecutive runs of the same month, so the group header is a real break. */
function byMonth(rows: readonly DailyRow[]): Array<{ label: string; rows: DailyRow[] }> {
  const groups: Array<{ label: string; rows: DailyRow[] }> = [];
  for (const row of rows) {
    const label = monthLabel(row.date);
    const current = groups.at(-1);
    if (current?.label === label) current.rows.push(row);
    else groups.push({ label, rows: [row] });
  }
  return groups;
}

export function UsageActivityTab({ stats }: { stats: UsageStats }) {
  const { sorted, head } = useSortedRows<DailyRow, SortKey>(stats.daily, sortValue, {
    key: "date",
    desc: true,
  });
  const activeDays = stats.daily.filter((day) => day.total_tokens > 0).length;

  const summary: Stat[] = [
    {
      label: "Last hour",
      value: formatNumber(stats.recent_activity.last_hour_requests),
      sub: "requests",
      title: "Requests proxied in the last sixty minutes.",
    },
    {
      label: "Last 24 hours",
      value: formatNumber(stats.recent_activity.last_24h_requests),
      sub: `${formatCompactTokens(stats.recent_activity.last_24h_tokens)} tokens`,
      title: "Requests and tokens in the last day.",
    },
    {
      label: "24h change",
      value: signed(stats.recent_activity.change_24h_pct),
      sub: `prev ${formatNumber(stats.recent_activity.prev_24h_requests)}`,
      title: "Requests in the last 24 hours against the 24 hours before that.",
      tone: changeTone(stats.recent_activity.change_24h_pct),
    },
    {
      label: "Tokens this week",
      value: formatNumber(stats.week_over_week.this_week.tokens),
      sub: `${formatNumber(stats.week_over_week.this_week.requests)} requests`,
      title: "Tokens since the start of the current week.",
    },
    {
      label: "Week over week",
      value: signed(stats.week_over_week.change_pct.tokens),
      sub: `req ${signed(stats.week_over_week.change_pct.requests)}`,
      title: "This week's tokens against last week's, and the same for requests.",
      tone: changeTone(stats.week_over_week.change_pct.tokens),
    },
    {
      label: "Active days",
      value: formatNumber(activeDays),
      sub: `of ${formatNumber(stats.daily.length)} recorded`,
      title: "Days in the retention window with at least one token proxied.",
    },
  ];

  const hourly: UsageBar[] = stats.hourly_pattern.map((bucket) => ({
    key: String(bucket.hour),
    label: String(bucket.hour).padStart(2, "0"),
    value: bucket.requests,
    title: `${String(bucket.hour).padStart(2, "0")}:00 — ${formatNumber(bucket.requests)} requests · ${formatNumber(bucket.tokens)} tokens`,
  }));

  return (
    <div className="space-y-8">
      <StatStrip stats={summary} />

      {hourly.length > 0 ? (
        <section>
          <div className="flex items-baseline justify-between gap-4">
            <h3 className="text-[length:var(--fs-md)] font-medium text-(--ui-fg)">Hour of day</h3>
            <span className="text-[length:var(--fs-xs)] text-(--dim)/70">
              requests by UTC hour, all time
            </span>
          </div>
          <p className="mt-1 mb-3 text-[length:var(--fs-sm)] text-(--ui-muted)">
            When this machine is actually asked to work — the window to schedule a benchmark or a
            restart in is the flat part.
          </p>
          <UsageBarRow bars={hourly} labels />
        </section>
      ) : null}

      {stats.daily.length === 0 ? (
        <TableNotice
          title="No daily history"
          body="The controller has not recorded a full day of traffic yet. This table fills in as requests accumulate."
        />
      ) : (
        <TableFrame minWidthClass="min-w-[52rem]">
          <thead>
            <tr>
              <HeadCell {...head("date")}>Date</HeadCell>
              <HeadCell {...head("requests")} numeric>
                Requests
              </HeadCell>
              <HeadCell {...head("tokens")} numeric>
                Tokens
              </HeadCell>
              <HeadCell {...head("prompt")} numeric title="Prompt tokens read">
                Prompt
              </HeadCell>
              <HeadCell {...head("completion")} numeric title="Completion tokens written">
                Completion
              </HeadCell>
              <HeadCell {...head("latency")} numeric>
                Avg latency
              </HeadCell>
              <HeadCell {...head("success")} numeric>
                Success
              </HeadCell>
            </tr>
          </thead>
          {byMonth(sorted).map((group) => (
            <tbody key={group.label}>
              <GroupRow
                colSpan={7}
                label={group.label}
                right={`${formatNumber(group.rows.reduce((sum, row) => sum + row.total_tokens, 0))} tokens`}
              />
              {group.rows.map((row) => (
                <DataRow key={row.date} dimmed={row.total_tokens === 0}>
                  <LeadCell>
                    <span className="text-[length:var(--fs-md)] text-(--fg)" title={row.date}>
                      {dayLabel(row.date)}
                    </span>
                  </LeadCell>
                  <NumCell>{formatNumber(row.requests)}</NumCell>
                  <NumCell strong>{formatNumber(row.total_tokens)}</NumCell>
                  <NumCell>{formatCompactTokens(row.prompt_tokens)}</NumCell>
                  <NumCell>{formatCompactTokens(row.completion_tokens)}</NumCell>
                  <NumCell>{formatMs(row.avg_latency_ms)}</NumCell>
                  <EndCell>
                    <StatusText tone={row.success_rate >= 99 ? "ok" : "dim"}>
                      {`${row.success_rate.toFixed(1)}%`}
                    </StatusText>
                  </EndCell>
                </DataRow>
              ))}
            </tbody>
          ))}
          {stats.peak_days.length > 0 ? (
            <tbody>
              <GroupRow
                colSpan={7}
                label="Busiest days"
                blurb="the ceiling this machine has actually handled"
              />
              {stats.peak_days.map((day) => (
                <DataRow key={`peak-${day.date}`}>
                  <LeadCell>
                    <span className="text-[length:var(--fs-md)] text-(--fg)">
                      {dayLabel(day.date)}
                    </span>
                  </LeadCell>
                  <NumCell>{formatNumber(day.requests)}</NumCell>
                  <NumCell strong>{formatNumber(day.tokens)}</NumCell>
                  <NumCell>—</NumCell>
                  <NumCell>—</NumCell>
                  <NumCell>—</NumCell>
                  <EndCell>
                    <StatusText>peak</StatusText>
                  </EndCell>
                </DataRow>
              ))}
            </tbody>
          ) : null}
        </TableFrame>
      )}
    </div>
  );
}
