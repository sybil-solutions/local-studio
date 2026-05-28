"use client";

import { formatNumber } from "@/lib/formatters";

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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 font-mono text-[9.5px] font-medium uppercase tracking-[0.18em] text-(--dim)/75">
      {children}
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border-r border-(--border)/40 pr-2 pl-3 first:pl-0 last:border-r-0 sm:pr-4 sm:pl-5">
      <dt className="truncate font-mono text-[9.5px] font-medium uppercase tracking-[0.18em] text-(--dim)/75">
        {label}
      </dt>
      <dd className="mt-1 font-mono text-[16px] leading-none tabular-nums text-(--fg)">{value}</dd>
    </div>
  );
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
        <Cell label="average" value={formatNumber(stats.tokens_per_request.avg)} />
        <Cell label="prompt" value={formatNumber(stats.tokens_per_request.avg_prompt)} />
        <Cell label="completion" value={formatNumber(stats.tokens_per_request.avg_completion)} />
      </dl>
      <dl className="mt-3 grid grid-cols-2 gap-2 font-mono text-[11px] text-(--dim)">
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
          <Cell label="hit rate" value={`${stats.cache.hit_rate.toFixed(1)}%`} />
          <Cell label="hits" value={formatNumber(stats.cache.hits)} />
          <Cell label="misses" value={formatNumber(stats.cache.misses)} />
        </dl>
        <dl className="mt-3 grid grid-cols-2 gap-2 font-mono text-[11px] text-(--dim)">
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
          <div className="font-mono text-[9.5px] font-medium uppercase tracking-[0.18em] text-(--dim)/75">
            Hourly activity
          </div>
          <span className="font-mono text-[10.5px] text-(--dim)">
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
                  <div className="font-mono text-[8.5px] text-(--dim)/60">{i}:00</div>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="mt-2 flex items-center justify-between font-mono text-[10.5px] text-(--dim)">
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
