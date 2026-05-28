"use client";

import { formatDurationOrUnavailable } from "@/lib/formatters";

interface LatencyStats {
  avg_ms: number | null;
  p50_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
  min_ms?: number | null;
  max_ms?: number | null;
}

interface PerformanceStats {
  latency: LatencyStats;
  ttft: LatencyStats;
}

function Bar({
  value,
  max,
  colorClass = "bg-(--fg)/30",
}: {
  value: number | null;
  max: number;
  colorClass?: string;
}) {
  const percentage = Math.min(100, ((value ?? 0) / (max > 0 ? max : 1)) * 100);
  return (
    <div className="h-1 w-full overflow-hidden bg-(--surface)">
      <div className={`h-full ${colorClass}`} style={{ width: `${percentage}%` }} />
    </div>
  );
}

function Row({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number | null;
  max: number;
  color?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between font-mono text-[11px]">
        <span className="text-(--dim)">{label}</span>
        <span className="tabular-nums text-(--fg)">{formatDurationOrUnavailable(value)}</span>
      </div>
      <Bar value={value} max={max} colorClass={color ?? "bg-(--fg)/30"} />
    </div>
  );
}

export function PerformanceDetails(stats: PerformanceStats) {
  const maxLatency = Math.max(
    stats.latency.avg_ms ?? 0,
    stats.latency.p95_ms ?? 0,
    stats.latency.p99_ms ?? 0,
  );
  const maxTTFT = Math.max(stats.ttft.avg_ms ?? 0, stats.ttft.p95_ms ?? 0, stats.ttft.p99_ms ?? 0);

  return (
    <section className="px-2 pt-2 pb-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="font-mono text-[9.5px] font-medium uppercase tracking-[0.18em] text-(--dim)/75">
          Latency
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-(--dim)/60">
          lower is better
        </span>
      </div>

      <div className="space-y-3 border-b border-(--border)/40 pb-4">
        <Row label="Average" value={stats.latency.avg_ms} max={maxLatency} color="bg-(--hl1)" />
        <Row label="P50" value={stats.latency.p50_ms} max={maxLatency} color="bg-(--hl2)" />
        <Row label="P95" value={stats.latency.p95_ms} max={maxLatency} color="bg-(--hl3)" />
        <Row label="P99" value={stats.latency.p99_ms} max={maxLatency} color="bg-(--err)" />
        {stats.latency.min_ms !== undefined && stats.latency.max_ms !== undefined ? (
          <div className="flex items-center justify-between font-mono text-[10.5px] text-(--dim)">
            <span>min {formatDurationOrUnavailable(stats.latency.min_ms)}</span>
            <span>max {formatDurationOrUnavailable(stats.latency.max_ms)}</span>
          </div>
        ) : null}
      </div>

      <div className="mb-3 mt-5 flex items-center justify-between">
        <div className="font-mono text-[9.5px] font-medium uppercase tracking-[0.18em] text-(--dim)/75">
          Time to first token
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-(--dim)/60">
          lower is better
        </span>
      </div>

      <div className="space-y-3">
        <Row label="Average" value={stats.ttft.avg_ms} max={maxTTFT} />
        <Row label="P50" value={stats.ttft.p50_ms} max={maxTTFT} />
        <Row label="P95" value={stats.ttft.p95_ms} max={maxTTFT} />
        <Row label="P99" value={stats.ttft.p99_ms} max={maxTTFT} />
      </div>
    </section>
  );
}
