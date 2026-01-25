interface GpuStatusSummaryProps {
  avgUtil: number;
  avgTemp: number;
  totalMem: number;
  totalMemMax: number;
  totalPower: number;
}

export function GpuStatusSummary({
  avgUtil,
  avgTemp,
  totalMem,
  totalMemMax,
  totalPower,
}: GpuStatusSummaryProps) {
  return (
    <div className="pt-2 mt-2 border-t border-(--border)/20">
      <div className="grid grid-cols-5 gap-4 items-center text-[10px]">
        <div className="text-(--muted-foreground)/50">Total</div>
        <div className="text-(--foreground)/60 tabular-nums">{avgUtil}% avg</div>
        <div className="text-(--foreground)/60 tabular-nums">
          {totalMem.toFixed(0)}/{totalMemMax.toFixed(0)}G
        </div>
        <div className="text-(--foreground)/60 tabular-nums">{avgTemp}° avg</div>
        <div className="text-(--foreground)/60 tabular-nums text-right">{Math.round(totalPower)}W</div>
      </div>
    </div>
  );
}
