"use client";

import { formatMs, formatNumber } from "@/lib/formatters";
import type { ControllerUsageStats, UsageStats } from "@/lib/types";
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
import { useSortedRows } from "./usage-sort";

type PathRow = ControllerUsageStats["by_path"][number];
type PathSortKey = "path" | "requests" | "failed" | "success" | "avg" | "max";

const pathSortValue = (row: PathRow, key: PathSortKey): number | string | null => {
  switch (key) {
    case "path":
      return `${row.path} ${row.method}`;
    case "failed":
      return row.failed;
    case "success":
      return row.success_rate;
    case "avg":
      return row.avg_duration_ms;
    case "max":
      return row.max_duration_ms;
    default:
      return row.requests;
  }
};

const STATUS_BANDS = [
  { label: "2xx — served", floor: 200, ceiling: 299 },
  { label: "3xx — redirected", floor: 300, ceiling: 399 },
  { label: "4xx — rejected", floor: 400, ceiling: 499 },
  { label: "5xx — failed", floor: 500, ceiling: 599 },
] as const;

/**
 * The controller's own request log.
 *
 * Everything on the other tabs is about the models; this is about the process
 * in front of them. It is normalised on every load and, until now, thrown away
 * — which meant a route that had started failing was invisible in the product
 * that owns the route.
 */
export function UsageControllerTab({ stats }: { stats: UsageStats }) {
  const controller = stats.controller;
  const { sorted, head } = useSortedRows<PathRow, PathSortKey>(
    controller?.by_path ?? [],
    pathSortValue,
    { key: "requests", desc: true },
  );

  if (!controller) {
    return (
      <TableNotice
        title="No controller telemetry"
        body="This controller build does not report request statistics, so there is nothing to show here. Everything on the other tabs comes from the proxy log instead."
      />
    );
  }

  const summary: Stat[] = [
    {
      label: "Requests",
      value: formatNumber(controller.totals.total_requests),
      sub: `${formatNumber(controller.totals.failed_requests)} failed`,
      title: "Every HTTP request the controller has served, not just model proxying.",
    },
    {
      label: "Success rate",
      value: `${controller.totals.success_rate.toFixed(1)}%`,
      title: "Share of controller requests that returned without an error status.",
      tone: controller.totals.success_rate >= 99 ? "ok" : "warn",
    },
    {
      label: "Avg duration",
      value: formatMs(controller.latency.avg_ms),
      title: "Mean handler time across all routes. Dominated by whichever route is called most.",
    },
    {
      label: "Slowest",
      value: formatMs(controller.latency.max_ms),
      title: "The single longest request the controller has served in its retention window.",
    },
    {
      label: "Last hour",
      value: formatNumber(controller.recent_activity.last_hour_requests),
      sub: `${formatNumber(controller.recent_activity.last_24h_requests)} in 24h`,
      title: "Controller requests in the last hour, and in the last day.",
    },
    {
      label: "Failed today",
      value: formatNumber(controller.recent_activity.last_24h_failed_requests),
      title: "Controller requests in the last 24 hours that ended in an error status.",
      tone: controller.recent_activity.last_24h_failed_requests > 0 ? "err" : "ok",
    },
  ];

  return (
    <div className="space-y-8">
      <StatStrip stats={summary} />

      {sorted.length > 0 ? (
        <TableFrame minWidthClass="min-w-[52rem]">
          <thead>
            <tr>
              <HeadCell {...head("path")}>Route</HeadCell>
              <HeadCell {...head("requests")} numeric>
                Requests
              </HeadCell>
              <HeadCell {...head("failed")} numeric>
                Failed
              </HeadCell>
              <HeadCell {...head("avg")} numeric>
                Avg
              </HeadCell>
              <HeadCell {...head("max")} numeric title="Slowest single call to this route">
                Max
              </HeadCell>
              <HeadCell {...head("success")} numeric>
                Success
              </HeadCell>
            </tr>
          </thead>
          <tbody>
            <GroupRow
              colSpan={6}
              label="Routes"
              blurb="every endpoint the controller has answered"
              right={`${sorted.length} routes`}
            />
            {sorted.map((row) => (
              <DataRow key={`${row.method} ${row.path}`} dimmed={row.requests === 0}>
                <LeadCell>
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="shrink-0 rounded bg-(--ui-hover) px-1.5 py-px font-mono text-[length:var(--fs-2xs)] text-(--dim)">
                      {row.method || "—"}
                    </span>
                    <span
                      className="min-w-0 truncate font-mono text-[length:var(--fs-sm)] text-(--fg)"
                      title={row.path}
                    >
                      {row.path}
                    </span>
                  </div>
                </LeadCell>
                <NumCell strong>{formatNumber(row.requests)}</NumCell>
                <NumCell>
                  {row.failed > 0 ? (
                    <span className="text-(--err)">{formatNumber(row.failed)}</span>
                  ) : (
                    "—"
                  )}
                </NumCell>
                <NumCell>{formatMs(row.avg_duration_ms)}</NumCell>
                <NumCell>{formatMs(row.max_duration_ms)}</NumCell>
                <EndCell>
                  <StatusText tone={row.failed > 0 ? "error" : "ok"}>
                    {`${row.success_rate.toFixed(1)}%`}
                  </StatusText>
                </EndCell>
              </DataRow>
            ))}
          </tbody>
        </TableFrame>
      ) : null}

      <StatusBands byStatus={controller.by_status} />
      <FunctionCalls calls={controller.function_calls} />
    </div>
  );
}

function StatusBands({ byStatus }: { byStatus: ControllerUsageStats["by_status"] }) {
  if (byStatus.length === 0) return null;
  const bands = STATUS_BANDS.map((band) => ({
    ...band,
    rows: byStatus
      .filter((row) => row.status >= band.floor && row.status <= band.ceiling)
      .sort((a, b) => b.requests - a.requests),
  })).filter((band) => band.rows.length > 0);

  return (
    <TableFrame minWidthClass="min-w-[24rem]">
      <thead>
        <tr>
          <HeadCell>Status</HeadCell>
          <HeadCell numeric>Requests</HeadCell>
        </tr>
      </thead>
      {bands.map((band) => (
        <tbody key={band.label}>
          <GroupRow
            colSpan={2}
            label={band.label}
            right={formatNumber(band.rows.reduce((sum, row) => sum + row.requests, 0))}
          />
          {band.rows.map((row) => (
            <DataRow key={row.status}>
              <LeadCell>
                <span className="font-mono text-[length:var(--fs-sm)] text-(--fg)">
                  {row.status}
                </span>
              </LeadCell>
              <EndCell>
                <span className="text-[length:var(--fs-sm)] text-(--dim)">
                  {formatNumber(row.requests)}
                </span>
              </EndCell>
            </DataRow>
          ))}
        </tbody>
      ))}
    </TableFrame>
  );
}

function FunctionCalls({ calls }: { calls: ControllerUsageStats["function_calls"] }) {
  if (!calls || calls.by_function.length === 0) return null;
  const summary: Stat[] = [
    {
      label: "Tool calls",
      value: formatNumber(calls.totals.total_calls),
      sub: `${formatNumber(calls.totals.failed_calls)} failed`,
      title: "Every tool invocation the agent runtime executed through this controller.",
    },
    {
      label: "Success rate",
      value: `${calls.totals.success_rate.toFixed(1)}%`,
      title: "Share of tool calls that returned a result instead of throwing.",
      tone: calls.totals.success_rate >= 99 ? "ok" : "warn",
    },
    {
      label: "Avg duration",
      value: formatMs(calls.latency.avg_ms),
      title: "Mean tool execution time. A slow tool is felt as a stalled turn.",
    },
    {
      label: "Slowest",
      value: formatMs(calls.latency.max_ms),
      title: "The single longest tool call recorded.",
    },
  ];

  return (
    <section className="space-y-5">
      <div>
        <h3 className="text-[length:var(--fs-md)] font-medium text-(--ui-fg)">Tool calls</h3>
        <p className="mt-1 text-[length:var(--fs-sm)] text-(--ui-muted)">
          How reliable the agent&apos;s tools are. A function with a low success rate here is a turn
          that silently goes nowhere in chat.
        </p>
      </div>
      <StatStrip stats={summary} />
      <TableFrame minWidthClass="min-w-[44rem]">
        <thead>
          <tr>
            <HeadCell>Function</HeadCell>
            <HeadCell numeric>Calls</HeadCell>
            <HeadCell numeric>Failed</HeadCell>
            <HeadCell numeric>Avg</HeadCell>
            <HeadCell numeric>Max</HeadCell>
            <HeadCell numeric>Success</HeadCell>
          </tr>
        </thead>
        <tbody>
          {[...calls.by_function]
            .sort((a, b) => b.calls - a.calls)
            .map((row) => (
              <DataRow key={row.function_name}>
                <LeadCell>
                  <span className="font-mono text-[length:var(--fs-sm)] text-(--fg)">
                    {row.function_name}
                  </span>
                </LeadCell>
                <NumCell strong>{formatNumber(row.calls)}</NumCell>
                <NumCell>
                  {row.failed > 0 ? (
                    <span className="text-(--err)">{formatNumber(row.failed)}</span>
                  ) : (
                    "—"
                  )}
                </NumCell>
                <NumCell>{formatMs(row.avg_duration_ms)}</NumCell>
                <NumCell>{formatMs(row.max_duration_ms)}</NumCell>
                <EndCell>
                  <StatusText tone={row.failed > 0 ? "error" : "ok"}>
                    {`${row.success_rate.toFixed(1)}%`}
                  </StatusText>
                </EndCell>
              </DataRow>
            ))}
        </tbody>
      </TableFrame>
    </section>
  );
}
