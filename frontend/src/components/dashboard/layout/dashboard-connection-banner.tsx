interface DashboardConnectionBannerProps {
  isConnected: boolean;
}

export function DashboardConnectionBanner({
  isConnected: _isConnected,
}: DashboardConnectionBannerProps) {
  // The status sheet carries connection state inline. Avoid a floating banner
  // over the operator dashboard; it breaks the calm no-card composition.
  return null;
}
