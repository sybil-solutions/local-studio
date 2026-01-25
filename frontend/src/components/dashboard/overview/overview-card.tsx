interface OverviewCardProps {
  label: string;
  value: string | number;
  sub?: string;
  tone?: "default" | "accent" | "success" | "muted";
}

export function OverviewCard({ label, value, sub, tone = "default" }: OverviewCardProps) {
  const toneClass =
    tone === "success"
      ? "text-(--success)/80"
      : tone === "accent"
        ? "text-(--foreground)"
        : tone === "muted"
          ? "text-(--muted-foreground)/60"
          : "text-(--foreground)/80";

  return (
    <div className="rounded-lg border border-(--border)/20 bg-(--card)/30 px-4 py-3">
      <div className="text-[10px] uppercase tracking-widest text-(--muted-foreground)/50">
        {label}
      </div>
      <div className={`mt-2 text-lg font-light tracking-tight ${toneClass}`}>{value}</div>
      {sub && <div className="mt-1 text-[10px] text-(--muted-foreground)/40">{sub}</div>}
    </div>
  );
}
