interface DashboardConnectionBannerProps {
  isConnected: boolean;
  reconnectAttempts: number;
}

export function DashboardConnectionBanner({
  isConnected,
  reconnectAttempts,
}: DashboardConnectionBannerProps) {
  if (isConnected) return null;

  return (
    <div className="fixed top-4 right-4 z-50 px-3 py-1.5 text-xs text-(--muted-foreground) bg-(--card) border border-(--border)">
      Reconnecting... ({reconnectAttempts})
    </div>
  );
}
