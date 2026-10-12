"use client";

import { RefreshCw } from "@/ui/icon-registry";
import { Button } from "./button";

interface RefreshButtonProps {
  onRefresh: () => void;
  loading?: boolean;
  className?: string;
  label?: string;
}

function RefreshButton({
  onRefresh,
  loading = false,
  className = "",
  label = "Refresh",
}: RefreshButtonProps) {
  return (
    <Button
      variant="icon"
      onClick={onRefresh}
      disabled={loading}
      className={className}
      aria-label={label}
      title={label}
    >
      <RefreshCw className={`h-4 w-4 text-(--ui-muted) ${loading ? "animate-spin" : ""}`} />
    </Button>
  );
}

export { RefreshButton };
export type { RefreshButtonProps };
