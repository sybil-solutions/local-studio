// CRITICAL
"use client";

import { formatDuration } from "@/lib/formatters";

interface LatencyStats {
  avg_ms: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  min_ms?: number;
  max_ms?: number;
}

interface PerformanceStats {
  latency: LatencyStats;
  ttft: LatencyStats;
}

export function PerformanceDetails(stats: PerformanceStats) {
  return (
    <>
      <div className="grid lg:grid-cols-2 gap-6 mb-6 pb-5 border-b border-(--border)/40">
        <section>
          <h2 className="text-xs uppercase tracking-wider text-(--muted-foreground) mb-3 font-medium">
            Latency
          </h2>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-(--muted-foreground)">Average</span>
              <span className="text-(--foreground) tabular-nums font-medium">
                {formatDuration(stats.latency.avg_ms)}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-(--muted-foreground)">P50</span>
              <span className="text-(--foreground) tabular-nums font-medium">
                {formatDuration(stats.latency.p50_ms)}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-(--muted-foreground)">P95</span>
              <span className="text-(--foreground) tabular-nums font-medium">
                {formatDuration(stats.latency.p95_ms)}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-(--muted-foreground)">P99</span>
              <span className="text-(--foreground) tabular-nums font-medium">
                {formatDuration(stats.latency.p99_ms)}
              </span>
            </div>
            {stats.latency.min_ms !== undefined && stats.latency.max_ms !== undefined && (
              <div className="pt-2 mt-2 border-t border-(--border)/20 flex items-center justify-between text-xs text-(--muted-foreground)">
                <span>Min: {formatDuration(stats.latency.min_ms)}</span>
                <span>Max: {formatDuration(stats.latency.max_ms)}</span>
              </div>
            )}
          </div>
        </section>

        <section>
          <h2 className="text-xs uppercase tracking-wider text-(--muted-foreground) mb-3 font-medium">
            Time to First Token
          </h2>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-(--muted-foreground)">Average</span>
              <span className="text-(--foreground) tabular-nums font-medium">
                {formatDuration(stats.ttft.avg_ms)}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-(--muted-foreground)">P50</span>
              <span className="text-(--foreground) tabular-nums font-medium">
                {formatDuration(stats.ttft.p50_ms)}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-(--muted-foreground)">P95</span>
              <span className="text-(--foreground) tabular-nums font-medium">
                {formatDuration(stats.ttft.p95_ms)}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-(--muted-foreground)">P99</span>
              <span className="text-(--foreground) tabular-nums font-medium">
                {formatDuration(stats.ttft.p99_ms)}
              </span>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
