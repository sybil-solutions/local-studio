"use client";

import { formatNumber } from "@/lib/formatters";
import { SectionLabel } from "@/ui";
import { MetricPanel, MiniBarChart } from "@/features/usage/metric-visuals";

interface TokensPerRequestStats {
  avg: number;
  avg_prompt: number;
  avg_completion: number;
  p50: number;
  p95: number;
}

interface HourlyPatternData {
  hour: number;
  requests: number;
}

interface SecondaryMetricsStats {
  tokens_per_request: TokensPerRequestStats;
  hourly_pattern: HourlyPatternData[];
}

export function SecondaryMetrics(stats: SecondaryMetricsStats) {
  const tokenMetricMax = Math.max(
    stats.tokens_per_request.avg,
    stats.tokens_per_request.p50,
    stats.tokens_per_request.p95,
    1,
  );
  const maxHourlyRequests = Math.max(
    ...stats.hourly_pattern.map((h: HourlyPatternData) => h.requests),
    1,
  );

  return (
    <section className="px-2 pt-2 pb-5">
      <div className="grid gap-6 lg:grid-cols-2">
        <MetricPanel title="Tokens per request" value={formatNumber(stats.tokens_per_request.avg)}>
          <MiniBarChart
            bars={[
              { label: "avg", value: stats.tokens_per_request.avg },
              { label: "p50", value: stats.tokens_per_request.p50 },
              { label: "p95", value: stats.tokens_per_request.p95 },
            ]}
            max={tokenMetricMax}
          />
          <div className="grid grid-cols-2 gap-2 font-mono text-[length:var(--fs-xs)] text-(--dim)">
            <div>
              prompt{" "}
              <span className="tabular-nums text-(--fg)">
                {formatNumber(stats.tokens_per_request.avg_prompt)}
              </span>
            </div>
            <div>
              completion{" "}
              <span className="tabular-nums text-(--fg)">
                {formatNumber(stats.tokens_per_request.avg_completion)}
              </span>
            </div>
          </div>
        </MetricPanel>

        <div>
          <SectionLabel>Hourly activity</SectionLabel>
          <div className="flex h-28 items-end gap-0.5 border-b border-(--border)/40 pb-2">
            {Array.from({ length: 24 }, (_: undefined, i: number) => {
              const hourData = stats.hourly_pattern.find((h: HourlyPatternData) => h.hour === i);
              const requests = hourData?.requests || 0;
              const height = (requests / maxHourlyRequests) * 100;
              return (
                <div key={i} className="group flex min-w-0 flex-1 flex-col items-center gap-1">
                  <div
                    className="w-full bg-(--hl3)"
                    style={{
                      height: `${Math.max(height, height > 0 ? 3 : 0)}%`,
                      minHeight: height > 0 ? "2px" : "0",
                    }}
                    title={`${i}:00 — ${formatNumber(requests)} requests`}
                  />
                  {i % 6 === 0 ? (
                    <div className="font-mono text-[length:var(--fs-2xs)] text-(--dim)/60">
                      {i}:00
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
