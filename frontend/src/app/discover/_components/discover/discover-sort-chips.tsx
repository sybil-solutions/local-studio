import type { ComponentType } from "react";

export function DiscoverSortChips({
  sort,
  sortOptions,
  onSortChange,
}: {
  sort: string;
  sortOptions: Array<{ value: string; label: string; icon: ComponentType<{ className?: string }> }>;
  onSortChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {sortOptions.map((option) => {
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            onClick={() => onSortChange(option.value)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs transition-colors ${
              sort === option.value
                ? "bg-(--hl1) text-white"
                : "bg-(--surface) border border-(--border) text-(--dim) hover:text-(--fg) hover:bg-(--surface)"
            }`}
          >
            <Icon className="h-3 w-3" />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
