import { Search, X } from "lucide-react";

export function DiscoverSearchToolbar({
  search,
  onSearchChange,
}: {
  search: string;
  onSearchChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="flex-1 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-(--dim)" />
        <input
          type="text"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search models..."
          className="w-full pl-10 pr-4 py-2 bg-(--surface) border border-(--border) rounded-lg text-sm text-(--fg) placeholder:text-(--dim)/50 focus:outline-none focus:border-(--hl1)"
        />
        {search && (
          <button
            onClick={() => onSearchChange("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-(--surface) rounded transition-colors"
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5 text-(--dim)" />
          </button>
        )}
      </div>
    </div>
  );
}
