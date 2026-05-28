import type { ComponentType } from "react";
import { Button } from "@/ui";

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
          <Button
            key={option.value}
            variant={sort === option.value ? "primary" : "secondary"}
            size="sm"
            onClick={() => onSortChange(option.value)}
            className="rounded-full"
            icon={<Icon className="h-3 w-3" />}
          >
            {option.label}
          </Button>
        );
      })}
    </div>
  );
}
