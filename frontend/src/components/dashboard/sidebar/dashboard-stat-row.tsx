interface DashboardStatRowProps {
  label: string;
  value: string | number;
  accent?: boolean;
}

export function DashboardStatRow({ label, value, accent }: DashboardStatRowProps) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-xs text-(--muted-foreground)/50">{label}</span>
      <span className={`text-xs tabular-nums ${accent ? "text-(--success)/80" : "text-(--foreground)/70"}`}>
        {value}
      </span>
    </div>
  );
}
