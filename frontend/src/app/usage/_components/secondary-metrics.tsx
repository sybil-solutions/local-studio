// CRITICAL
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

export function SecondaryMetrics(stats: SecondaryMetricsStats) {
  return (
    <div className="grid lg:grid-cols-3 gap-6">
      <section>
        <h2 className="text-xs uppercase tracking-wider text-(--muted-foreground) mb-3 font-medium">
          Tokens per Request
        </h2>
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-(--muted-foreground)">Average</span>
            <span className="text-(--foreground) tabular-nums font-medium">
              {formatNumber(stats.tokens_per_request.avg)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-(--muted-foreground)">Prompt</span>
            <span className="text-(--foreground) tabular-nums">
              {formatNumber(stats.tokens_per_request.avg_prompt)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-(--muted-foreground)">Completion</span>
            <span className="text-(--foreground) tabular-nums">
              {formatNumber(stats.tokens_per_request.avg_completion)}
            </span>
          </div>
          <div className="pt-2 mt-2 border-t border-(--border)/20 flex items-center justify-between text-xs text-(--muted-foreground)">
            <span>P50: {formatNumber(stats.tokens_per_request.p50)}</span>
            <span>P95: {formatNumber(stats.tokens_per_request.p95)}</span>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-xs uppercase tracking-wider text-(--muted-foreground) mb-3 font-medium">
          Cache
        </h2>
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-(--muted-foreground)">Hit Rate</span>
            <span className="text-(--foreground) tabular-nums font-medium">
              {stats.cache.hit_rate.toFixed(1)}%
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-(--muted-foreground)">Hits</span>
            <span className="text-(--foreground) tabular-nums">
              {formatNumber(stats.cache.hits)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-(--muted-foreground)">Misses</span>
            <span className="text-(--foreground) tabular-nums">
              {formatNumber(stats.cache.misses)}
            </span>
          </div>
          <div className="pt-2 mt-2 border-t border-(--border)/20">
            <div className="flex items-center justify-between text-xs text-(--muted-foreground)">
              <span>Cached: {formatNumber(stats.cache.hit_tokens)}</span>
              <span>Uncached: {formatNumber(stats.cache.miss_tokens)}</span>
            </div>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-xs uppercase tracking-wider text-(--muted-foreground) mb-3 font-medium">
          Hourly Pattern
        </h2>
        <div className="flex items-end gap-0.5 h-32 overflow-x-auto pb-2">
          {Array.from({ length: 24 }, (_: unknown, i: number) => {
            const hourData = stats.hourly_pattern.find((h: HourlyPatternData) => h.hour === i);
            const requests = hourData?.requests || 0;
            const maxHourlyRequests = Math.max(...stats.hourly_pattern.map((h: HourlyPatternData) => h.requests), 1);
            const height = (requests / maxHourlyRequests) * 100;
            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-0.5 group min-w-0">
                <div
                  className="w-full bg-(--foreground)/20 rounded-t transition-all group-hover:bg-(--foreground)/30"
                  style={{
                    height: `${height}%`,
                    minHeight: height > 0 ? "1px" : "0",
                  }}
                  title={`${i}:00 - ${i + 1}:00: ${requests} requests`}
                />
                <div className="text-[7px] text-(--muted-foreground)/60 truncate w-full text-center">
                  {i % 6 === 0 ? `${i}:00` : ""}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
