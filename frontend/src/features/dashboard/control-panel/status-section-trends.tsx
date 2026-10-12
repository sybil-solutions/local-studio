"use client";

import { useMemo, useRef, useState } from "react";
import { getStoredBackendUrl } from "@/lib/api/connection";
import type { MetricSampleInput } from "./status-section-view";

type MetricSample = {
  at: number;
  generation: number;
  prefill: number;
};

type MetricPeak = {
  generation: number;
  prefill: number;
};

type TrendSeries = {
  label: string;
  values: number[];
  className: string;
  digits: number;
  peak?: number;
  peakClassName?: string;
};

const samplesByKey = new Map<string, MetricSample[]>();

function scopedSampleKey(key: string): string {
  return `${getStoredBackendUrl() || "default"}::${key}`;
}

export function useMetricSamples({
  key,
  generation,
  generationPeak,
  prefill,
  prefillPeak,
  active,
}: MetricSampleInput) {
  const samplesRef = useRef<MetricSample[]>([]);
  const sampleKeyRef = useRef<string | null>(null);
  const scopedKey = scopedSampleKey(key);
  const peaks: MetricPeak = {
    generation: finitePositive(generationPeak),
    prefill: finitePositive(prefillPeak),
  };

  if (sampleKeyRef.current !== scopedKey) {
    sampleKeyRef.current = scopedKey;
    samplesRef.current = samplesByKey.get(scopedKey) ?? [];
  }
  if (!active) return { samples: zeroSamples(), peaks };

  const next: MetricSample = {
    at: Date.now(),
    generation: finitePositive(generation),
    prefill: finitePositive(prefill),
  };
  const current = samplesRef.current;
  const previous = current[current.length - 1];
  if (!previous || previous.generation !== next.generation || previous.prefill !== next.prefill) {
    const nextSamples = [...current, next].slice(-56);
    samplesRef.current = nextSamples;
    samplesByKey.set(scopedKey, nextSamples);
  }

  return { samples: samplesRef.current.length > 0 ? samplesRef.current : zeroSamples(), peaks };
}

/**
 * One panel, one unit.
 *
 * There used to be three: throughput, TTFT and live requests. The TTFT series
 * was a cumulative average — a line that flattens the longer the session runs
 * and cannot show a regression — and requests on a mostly single-user rig is a
 * step between 0 and 1. Both were decoration. Throughput is the number this
 * page exists for, so it keeps the whole width.
 */
export function MetricTrends({ samples, peaks }: { samples: MetricSample[]; peaks: MetricPeak }) {
  const times = samples.map((sample) => sample.at);
  const window = describeWindow(samples);
  return (
    <div className="mt-4 border-t border-(--separator) pt-3 sm:mt-6">
      <TrendPanel
        label="Throughput"
        unit="tok/s"
        meta={window}
        times={times}
        series={[
          {
            label: "prefill",
            values: samples.map((sample) => sample.prefill),
            className: "text-(--fg)/80",
            digits: 0,
            peak: peaks.prefill,
            peakClassName: "text-(--hl2)/55",
          },
          {
            label: "decode",
            values: samples.map((sample) => sample.generation),
            className: "text-(--accent)/75",
            digits: 1,
            peak: peaks.generation,
            peakClassName: "text-(--accent)/45",
          },
        ]}
      />
    </div>
  );
}

function TrendPanel({
  label,
  unit,
  meta,
  times,
  series,
}: {
  label: string;
  unit: string;
  meta: string;
  times: number[];
  series: TrendSeries[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const count = Math.max(...series.map((line) => line.values.length), 0);
  const index = hover !== null && hover < count ? hover : null;
  const at = index !== null ? times[index] : undefined;

  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="shrink-0 text-[length:var(--fs-sm)] font-medium text-(--hl2)">
          {label}
          <span className="ml-1.5 text-[length:var(--fs-xs)] font-normal text-(--dim)/50">
            {unit}
          </span>
        </span>
        <span className="flex min-w-0 items-baseline gap-3 font-mono text-[length:var(--fs-xs)] tabular-nums">
          {series.map((line) => (
            <span key={line.label} className="inline-flex shrink-0 items-baseline gap-1">
              <span className="text-(--dim)/55">{line.label}</span>
              <span className={line.className}>{readout(line, index)}</span>
            </span>
          ))}
        </span>
      </div>
      <div className="h-20 sm:h-28">
        <Sparkline
          series={series}
          hoverIndex={index}
          onHover={setHover}
          pointCount={Math.max(count, 2)}
        />
      </div>
      <div className="mt-1 truncate text-[length:var(--fs-2xs)] text-(--dim)/45">
        {at ? formatClock(at) : meta}
      </div>
    </div>
  );
}

function readout(line: TrendSeries, index: number | null): string {
  const values = line.values;
  if (values.length === 0) return "—";
  const value = index !== null ? values[index] : values[values.length - 1];
  return Number.isFinite(value) ? value.toFixed(line.digits) : "—";
}

function Sparkline({
  series,
  hoverIndex,
  onHover,
  pointCount,
}: {
  series: TrendSeries[];
  hoverIndex: number | null;
  onHover: (index: number | null) => void;
  pointCount: number;
}) {
  // One scale per panel, not one per line: two series in the same unit that are
  // each normalised to their own maximum are not comparable, which is what made
  // the old throughput chart misleading rather than merely undecorated.
  const scaled = useMemo(() => {
    const max = Math.max(
      1,
      ...series.flatMap((line) => line.values.filter((value) => Number.isFinite(value))),
      ...series.map((line) => (Number.isFinite(line.peak) ? (line.peak ?? 0) : 0)),
    );
    return series.map((line) => ({
      ...line,
      points: toPolyline(line.values, max),
      peakY: line.peak && line.peak > 0 ? yForValue(line.peak, max) : null,
    }));
  }, [series]);

  const hoverX = hoverIndex !== null ? (hoverIndex / Math.max(1, pointCount - 1)) * 320 : null;

  return (
    <svg
      className="h-full w-full overflow-visible text-(--border)"
      viewBox="0 0 320 96"
      preserveAspectRatio="none"
      onMouseMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        if (rect.width <= 0) return;
        const ratio = (event.clientX - rect.left) / rect.width;
        const next = Math.round(ratio * (pointCount - 1));
        onHover(Math.min(pointCount - 1, Math.max(0, next)));
      }}
      onMouseLeave={() => onHover(null)}
    >
      <path
        d="M0 16H320 M0 48H320 M0 80H320"
        stroke="currentColor"
        strokeOpacity="0.42"
        strokeWidth="0.6"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d="M0 95.5H320"
        stroke="currentColor"
        strokeOpacity="0.75"
        strokeWidth="0.7"
        vectorEffect="non-scaling-stroke"
      />
      {scaled.map((line) =>
        line.peakY !== null ? (
          <path
            key={`peak-${line.label}`}
            d={`M0 ${line.peakY.toFixed(1)}H320`}
            fill="none"
            className={line.peakClassName}
            stroke="currentColor"
            strokeDasharray="4 5"
            strokeLinecap="square"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ) : null,
      )}
      {scaled.map((line, index) => (
        <polyline
          key={line.label}
          points={line.points}
          fill="none"
          className={line.className}
          stroke="currentColor"
          strokeWidth={index === 0 ? 1.6 : 1.1}
          strokeLinecap="square"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {hoverX !== null ? (
        <path
          d={`M${hoverX.toFixed(1)} 0V96`}
          className="text-(--fg)/35"
          stroke="currentColor"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
    </svg>
  );
}

/**
 * The window the samples actually cover.
 *
 * The panels used to be captioned "Last 30 minutes" regardless of poll rate or
 * how long the tab had been open — a caption that is wrong on a fresh page load
 * is worse than no caption.
 */
function describeWindow(samples: MetricSample[]): string {
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (!first || !last || first.at === 0) return "no samples yet";
  const span = last.at - first.at;
  if (span < 30_000) return "just started";
  const minutes = span / 60_000;
  if (minutes < 60) return `last ${Math.round(minutes)} min`;
  return `last ${(minutes / 60).toFixed(1)} h`;
}

function formatClock(at: number): string {
  return new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function toPolyline(values: number[], max: number): string {
  const padded = values.length >= 2 ? values : [0, ...values];
  const width = 320;
  const last = Math.max(1, padded.length - 1);
  return padded
    .map((value, index) => {
      const x = (index / last) * width;
      const y = yForValue(value, max);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function yForValue(value: number, max: number): number {
  return 94 - (Math.max(0, value) / max) * 92;
}

function finitePositive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * The flat line an idle engine draws.
 *
 * `at: 0` is deliberate — these samples were never observed, so they must not
 * be given plausible timestamps that the window caption and the hover readout
 * would then report as measurements.
 */
function zeroSamples(): MetricSample[] {
  return Array.from({ length: 34 }, () => ({
    at: 0,
    generation: 0,
    prefill: 0,
  }));
}
