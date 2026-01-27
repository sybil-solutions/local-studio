// CRITICAL
"use client";

import { formatDuration } from "@/lib/formatters";
import { Timer, TrendingDown, TrendingUp } from "lucide-react";

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

function MiniBar({
  value,
  max,
  colorClass = "bg-[#f0ebe3]/30",
}: {
  value: number;
  max: number;
  colorClass?: string;
}) {
  const percentage = Math.min(100, (value / max) * 100);
  return (
    <div className="h-1 w-full bg-[#363432] rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full ${colorClass}`}
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}

export function PerformanceDetails(stats: PerformanceStats) {
  const maxLatency = Math.max(stats.latency.avg_ms, stats.latency.p95_ms, stats.latency.p99_ms);
  const maxTTFT = Math.max(stats.ttft.avg_ms, stats.ttft.p95_ms, stats.ttft.p99_ms);

  return (
    <div className="bg-[#1e1e1e] rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 sm:px-6 py-3 border-b border-[#363432] text-[#9a9088]">
        <Timer className="h-4 w-4" />
        <span className="text-xs uppercase tracking-wider">Performance Metrics</span>
      </div>

      <div className="p-4 sm:p-6 space-y-6">
        {/* Latency Section */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-[#9a9088]">Latency Distribution</span>
            <span className="text-[10px] text-[#9a9088]">Lower is better</span>
          </div>

          <div className="space-y-3">
            {[
              { label: "Average", value: stats.latency.avg_ms, color: "bg-[#6b9ac9]" },
              { label: "P50", value: stats.latency.p50_ms, color: "bg-[#7d9a6a]" },
              { label: "P95", value: stats.latency.p95_ms, color: "bg-[#c9a66b]" },
              { label: "P99", value: stats.latency.p99_ms, color: "bg-[#c97a6b]" },
            ].map((item) => (
              <div key={item.label} className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[#9a9088]">{item.label}</span>
                  <span className="tabular-nums">{formatDuration(item.value)}</span>
                </div>
                <MiniBar value={item.value} max={maxLatency} colorClass={item.color} />
              </div>
            ))}
          </div>

          {stats.latency.min_ms !== undefined && stats.latency.max_ms !== undefined && (
            <div className="mt-3 pt-3 border-t border-[#363432] flex items-center justify-between text-xs text-[#9a9088]">
              <div className="flex items-center gap-1">
                <TrendingDown className="h-3 w-3" />
                <span>Min: {formatDuration(stats.latency.min_ms)}</span>
              </div>
              <div className="flex items-center gap-1">
                <TrendingUp className="h-3 w-3" />
                <span>Max: {formatDuration(stats.latency.max_ms)}</span>
              </div>
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="h-px bg-[#363432]" />

        {/* TTFT Section */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-[#9a9088]">Time to First Token</span>
            <span className="text-[10px] text-[#9a9088]">Lower is better</span>
          </div>

          <div className="space-y-3">
            {[
              { label: "Average", value: stats.ttft.avg_ms },
              { label: "P50", value: stats.ttft.p50_ms },
              { label: "P95", value: stats.ttft.p95_ms },
              { label: "P99", value: stats.ttft.p99_ms },
            ].map((item) => (
              <div key={item.label} className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[#9a9088]">{item.label}</span>
                  <span className="tabular-nums">{formatDuration(item.value)}</span>
                </div>
                <MiniBar value={item.value} max={maxTTFT} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
