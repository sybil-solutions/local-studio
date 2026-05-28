import { Filter } from "lucide-react";
import { RefreshButton } from "@/components/ui-kit/refresh-button";

export function DiscoverHeader({
  showFilters,
  onToggleFilters,
  onRefresh,
  loading,
}: {
  showFilters: boolean;
  onToggleFilters: () => void;
  onRefresh: () => void;
  loading: boolean;
}) {
  return (
    <div
      className="flex items-center justify-between border-b border-(--border)"
      style={{
        paddingLeft: "1.5rem",
        paddingRight: "1.5rem",
        paddingTop: "1rem",
        paddingBottom: "1rem",
      }}
    >
      <h1 className="text-xl font-semibold">Discover Models</h1>
      <div className="flex items-center gap-2">
        <button
          onClick={onToggleFilters}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
            showFilters
              ? "bg-(--hl1) text-white"
              : "bg-(--surface) border border-(--border) text-(--dim) hover:text-(--fg)"
          }`}
        >
          <Filter className="h-4 w-4" />
          <span className="hidden sm:inline">Filters</span>
        </button>
        {RefreshButton({
          onRefresh,
          loading,
          className: "hover:bg-(--surface) disabled:opacity-50",
        })}
      </div>
    </div>
  );
}
