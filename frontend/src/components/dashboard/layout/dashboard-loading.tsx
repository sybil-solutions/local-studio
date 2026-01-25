export function DashboardLoading() {
  return (
    <div className="flex items-center justify-center h-full bg-(--background)">
      <div className="text-(--muted-foreground) animate-pulse">Loading...</div>
    </div>
  );
}
