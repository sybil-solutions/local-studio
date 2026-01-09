'use client';

import { useMemo } from 'react';

interface DataPoint {
  value: number;
  timestamp?: number;
}

interface MiniChartProps {
  data: DataPoint[] | number[];
  height?: number;
  width?: number;
  strokeColor?: string;
  fillColor?: string;
  showDots?: boolean;
  showArea?: boolean;
  minValue?: number;
  maxValue?: number;
  className?: string;
}

/**
 * Minimal SVG sparkline/area chart component.
 * No external dependencies, renders efficiently.
 */
export function MiniChart({
  data,
  height = 40,
  width = 120,
  strokeColor = 'var(--success)',
  fillColor = 'var(--success)',
  showDots = false,
  showArea = true,
  minValue,
  maxValue,
  className = '',
}: MiniChartProps) {
  const points = useMemo(() => {
    if (!data || data.length === 0) return [];

    // Normalize data to DataPoint format
    const normalized: number[] = data.map(d =>
      typeof d === 'number' ? d : d.value
    );

    if (normalized.length < 2) return [];

    // Calculate bounds
    const dataMin = minValue ?? Math.min(...normalized);
    const dataMax = maxValue ?? Math.max(...normalized);
    const range = dataMax - dataMin || 1;

    // Padding
    const padX = 2;
    const padY = 4;
    const chartWidth = width - padX * 2;
    const chartHeight = height - padY * 2;

    // Generate points
    return normalized.map((value, i) => ({
      x: padX + (i / (normalized.length - 1)) * chartWidth,
      y: padY + chartHeight - ((value - dataMin) / range) * chartHeight,
      value,
    }));
  }, [data, width, height, minValue, maxValue]);

  if (points.length < 2) {
    return (
      <div className={`flex items-center justify-center ${className}`} style={{ height, width }}>
        <span className="text-[10px] text-[#9a9590]">--</span>
      </div>
    );
  }

  // Build path
  const linePath = points.map((p, i) =>
    (i === 0 ? 'M' : 'L') + `${p.x.toFixed(1)},${p.y.toFixed(1)}`
  ).join(' ');

  // Area path (closes at bottom)
  const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(1)},${height - 2} L${points[0].x.toFixed(1)},${height - 2} Z`;

  return (
    <svg
      width={width}
      height={height}
      className={className}
      style={{ overflow: 'visible' }}
    >
      {/* Area fill */}
      {showArea && (
        <path
          d={areaPath}
          fill={fillColor}
          fillOpacity={0.15}
        />
      )}

      {/* Line */}
      <path
        d={linePath}
        fill="none"
        stroke={strokeColor}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Dots */}
      {showDots && points.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={2}
          fill={strokeColor}
        />
      ))}

      {/* End dot */}
      <circle
        cx={points[points.length - 1].x}
        cy={points[points.length - 1].y}
        r={2.5}
        fill={strokeColor}
      />
    </svg>
  );
}

interface BarChartProps {
  data: number[];
  height?: number;
  width?: number;
  barColor?: string;
  maxValue?: number;
  className?: string;
}

/**
 * Minimal bar chart component.
 */
export function MiniBarChart({
  data,
  height = 40,
  width = 120,
  barColor = 'var(--success)',
  maxValue,
  className = '',
}: BarChartProps) {
  const bars = useMemo(() => {
    if (!data || data.length === 0) return [];

    const max = maxValue ?? Math.max(...data, 1);
    const barWidth = Math.max(2, (width - data.length * 2) / data.length);
    const gap = 2;

    return data.map((value, i) => ({
      x: i * (barWidth + gap),
      height: Math.max(2, (value / max) * (height - 4)),
      value,
    }));
  }, [data, width, height, maxValue]);

  if (bars.length === 0) {
    return (
      <div className={`flex items-center justify-center ${className}`} style={{ height, width }}>
        <span className="text-[10px] text-[#9a9590]">--</span>
      </div>
    );
  }

  const barWidth = Math.max(2, (width - data.length * 2) / data.length);

  return (
    <svg width={width} height={height} className={className}>
      {bars.map((bar, i) => (
        <rect
          key={i}
          x={bar.x}
          y={height - bar.height - 2}
          width={barWidth}
          height={bar.height}
          rx={1}
          fill={barColor}
          fillOpacity={i === bars.length - 1 ? 1 : 0.6}
        />
      ))}
    </svg>
  );
}

interface GaugeProps {
  value: number;
  max?: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  bgColor?: string;
  showValue?: boolean;
  label?: string;
  className?: string;
}

/**
 * Circular gauge/progress indicator.
 */
export function MiniGauge({
  value,
  max = 100,
  size = 60,
  strokeWidth = 6,
  color = 'var(--success)',
  bgColor = 'var(--border)',
  showValue = true,
  label,
  className = '',
}: GaugeProps) {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;

  // Color based on value
  const getColor = () => {
    if (percentage > 90) return 'var(--error)';
    if (percentage > 70) return 'var(--warning)';
    return color;
  };

  return (
    <div className={`relative inline-flex items-center justify-center ${className}`}>
      <svg width={size} height={size} className="-rotate-90">
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={bgColor}
          strokeWidth={strokeWidth}
        />
        {/* Progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={getColor()}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-300"
        />
      </svg>
      {showValue && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xs font-mono font-semibold">{Math.round(percentage)}%</span>
          {label && <span className="text-[8px] text-[#9a9590]">{label}</span>}
        </div>
      )}
    </div>
  );
}
