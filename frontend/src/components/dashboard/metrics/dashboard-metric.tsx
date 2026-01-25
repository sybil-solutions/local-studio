interface DashboardMetricProps {
  label: string;
  value: string | number;
  unit?: string;
  sub?: string;
}

export function DashboardMetric({ label, value, unit, sub }: DashboardMetricProps) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-(--muted-foreground)/50 mb-1.5">{label}</div>
      <div className="flex items-baseline gap-1">
        <span className="text-lg font-light tracking-tight tabular-nums text-(--foreground)/80">{value}</span>
        {unit && value !== "--" && <span className="text-[10px] text-(--muted-foreground)/40">{unit}</span>}
      </div>
      {sub && <div className="text-[10px] text-(--muted-foreground)/40 mt-1 tabular-nums">{sub}</div>}
    </div>
  );
}
