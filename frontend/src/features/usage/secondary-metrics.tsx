"use client";

import { formatNumber } from "@/lib/formatters";
import { Stat, SectionLabel } from "@/ui";

interface TokensPerRequestStats {
  avg: number;
  avg_prompt: number;
  avg_completion: number;
  p50: number;
  p95: number;
}

interface CacheStats {
  hit_rate: number;
  hits: number;
  misses: number;
  hit_tokens: number;
  miss_tokens: number;
}

interface HourlyPatternData {
  hour: number;
  requests: number;
}

interface SecondaryMetricsStats {
  tokens_per_request: TokensPerRequestStats;
  cache: CacheStats;
  hourly_pattern: HourlyPatternData[];
}

export function SecondaryMetrics(stats: SecondaryMetricsStats) {
  const maxHourlyRequests = Math.max(
    ...stats.hourly_pattern.map((h: HourlyPatternData) => h.requests),
    1,
  );
  const peakHour = stats.hourly_pattern.reduce(
    (max, h) => (h.requests > max.requests ? h : max),
    stats.hourly_pattern[0],
  );
  const totalRequests = stats.hourly_pattern.reduce((sum, h) => sum + h.requests, 0);

  return (
    <section className="px-2 pt-2 pb-5">
      <SectionLabel>Tokens per request</SectionLabel>
      <dl className="grid grid-cols-3 border-b border-(--border)/40 pb-4">
        <Stat label="average" value={formatNumber(stats.tokens_per_request.avg)} />
        <Stat label="prompt" value={formatNumber(stats.tokens_per_request.avg_prompt)} />
        <Stat label="completion" value={formatNumber(stats.tokens_per_request.avg_completion)} />
      </dl>
      <dl className="mt-3 grid grid-cols-2 gap-2 font-mono text-[length:var(--fs-sm)] text-(--dim)">
        <div>
          p50{" "}
          <span className="tabular-nums text-(--fg)">
            {formatNumber(stats.tokens_per_request.p50)}
          </span>
        </div>
        <div>
          p95{" "}
          <span className="tabular-nums text-(--fg)">
            {formatNumber(stats.tokens_per_request.p95)}
          </span>
        </div>
      </dl>

      <div className="mt-6">
        <SectionLabel>Cache</SectionLabel>
        <dl className="grid grid-cols-3 border-b border-(--border)/40 pb-4">
          <Stat label="hit rate" value={`${stats.cache.hit_rate.toFixed(1)}%`} />
          <Stat label="hits" value={formatNumber(stats.cache.hits)} />
          <Stat label="misses" value={formatNumber(stats.cache.misses)} />
        </dl>
        <dl className="mt-3 grid grid-cols-2 gap-2 font-mono text-[length:var(--fs-sm)] text-(--dim)">
          <div>
            cached{" "}
            <span className="tabular-nums text-(--fg)">{formatNumber(stats.cache.hit_tokens)}</span>
          </div>
          <div>
            uncached{" "}
            <span className="tabular-nums text-(--fg)">
              {formatNumber(stats.cache.miss_tokens)}
            </span>
          </div>
        </dl>
      </div>

      <div className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <SectionLabel className="mb-0">Hourly activity</SectionLabel>
          <span className="font-mono text-[length:var(--fs-xs)] text-(--dim)">
            peak {peakHour?.hour ?? 0}:00 ·{" "}
            <span className="tabular-nums text-(--fg)">
              {formatNumber(peakHour?.requests || 0)}
            </span>{" "}
            req
          </span>
        </div>

        <div className="flex h-20 items-end gap-0.5 border-b border-(--border)/40 pb-2">
          {Array.from({ length: 24 }, (_: undefined, i: number) => {
            const hourData = stats.hourly_pattern.find((h: HourlyPatternData) => h.hour === i);
            const requests = hourData?.requests || 0;
            const height = (requests / maxHourlyRequests) * 100;
            const isPeak = requests === maxHourlyRequests && requests > 0;
            return (
              <div key={i} className="group flex min-w-0 flex-1 flex-col items-center gap-1">
                <div
                  className={`w-full ${isPeak ? "bg-(--hl3)" : "bg-(--fg)/20"}`}
                  style={{
                    height: `${Math.max(height, 3)}%`,
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

        <div className="mt-2 flex items-center justify-between font-mono text-[length:var(--fs-xs)] text-(--dim)">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 bg-(--hl3)" />
            peak hour
          </span>
          <span>
            total <span className="tabular-nums text-(--fg)">{formatNumber(totalRequests)}</span>{" "}
            req
          </span>
        </div>
      </div>
    </section>
  );
}
