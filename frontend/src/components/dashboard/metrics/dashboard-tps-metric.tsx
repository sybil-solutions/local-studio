interface DashboardTpsMetricProps {
  label: string;
  value: number;
  peak: number;
}

export function DashboardTpsMetric({ label, value, peak }: DashboardTpsMetricProps) {
  const pct = peak > 0 ? Math.min((value / peak) * 100, 100) : 0;

  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-(--muted-foreground)/50 mb-1.5">{label}</div>
      <div className="flex items-baseline gap-1">
        <span className="text-lg font-light tracking-tight tabular-nums text-(--foreground)/80">
          {value > 0 ? value.toFixed(1) : "--"}
        </span>
        {value > 0 && <span className="text-[10px] text-(--muted-foreground)/40">tok/s</span>}
      </div>
      {peak > 0 && (
        <div className="mt-2 space-y-1">
          <div className="h-1 bg-(--muted)/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-(--foreground)/25 rounded-full transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="text-[10px] text-(--muted-foreground)/40 tabular-nums">peak {peak.toFixed(1)}</div>
        </div>
      )}
    </div>
  );
}
