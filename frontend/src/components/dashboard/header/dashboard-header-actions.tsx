interface DashboardHeaderActionsProps {
  onNavigateChat: () => void;
  onNavigateLogs: () => void;
  onBenchmark: () => void;
  benchmarking: boolean;
  onStop: () => void;
}

export function DashboardHeaderActions({
  onNavigateChat,
  onNavigateLogs,
  onBenchmark,
  benchmarking,
  onStop,
}: DashboardHeaderActionsProps) {
  return (
    <nav className="flex items-center gap-4 text-xs">
      <button onClick={onNavigateChat} className="text-(--muted-foreground)/70 hover:text-(--foreground) transition-colors">
        chat
      </button>
      <button onClick={onNavigateLogs} className="text-(--muted-foreground)/70 hover:text-(--foreground) transition-colors">
        logs
      </button>
      <button
        onClick={onBenchmark}
        disabled={benchmarking}
        className="text-(--muted-foreground)/70 hover:text-(--foreground) transition-colors disabled:opacity-30 disabled:cursor-not-allowed hidden sm:block"
      >
        {benchmarking ? "running..." : "benchmark"}
      </button>
      <span className="text-(--border)/30">·</span>
      <button onClick={onStop} className="text-(--muted-foreground)/70 hover:text-(--error)/80 transition-colors">
        stop
      </button>
    </nav>
  );
}
