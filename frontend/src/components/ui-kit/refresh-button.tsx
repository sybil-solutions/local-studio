// CRITICAL
import { RefreshCw } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";

type RefreshButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  loading?: boolean;
  onRefresh: () => void;
  label?: string;
};

/** Shared reload action for data-heavy pages. */
export function RefreshButton({
  loading = false,
  onRefresh,
  label = "Refresh",
  className = "",
  disabled,
  ...props
}: RefreshButtonProps) {
  return (
    <button
      type="button"
      onClick={onRefresh}
      disabled={disabled || loading}
      className={`inline-flex items-center gap-2 px-3 py-2 text-sm text-(--dim) hover:text-(--fg) disabled:cursor-not-allowed ${className}`}
      aria-busy={loading}
      {...props}
    >
      <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
      <span className="hidden sm:inline">{loading ? "Refreshing" : label}</span>
    </button>
  );
}
