"use client";

import { Search, X } from "@/ui/icon-registry";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onClear?: () => void;
  className?: string;
}

function SearchInput({
  value,
  onChange,
  placeholder = "Search...",
  onClear,
  className = "",
}: SearchInputProps) {
  const handleClear = () => {
    if (onClear) {
      onClear();
    } else {
      onChange("");
    }
  };

  return (
    <div className={`relative ${className}`}>
      <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-(--ui-muted)" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-[var(--ui-radius)] border border-(--ui-separator) bg-(--ui-surface) pl-9 pr-8 text-[length:var(--fs-base)] text-(--ui-fg) transition-colors placeholder:text-(--ui-muted)/70 focus:border-(--ui-accent)/60 focus:outline-none focus:ring-1 focus:ring-(--ui-accent)/20"
      />
      {value && (
        <button
          onClick={handleClear}
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 transition-colors hover:bg-(--ui-hover)"
          aria-label="Clear search"
        >
          <X className="h-3.5 w-3.5 text-(--ui-muted)" />
        </button>
      )}
    </div>
  );
}

export { SearchInput };
export type { SearchInputProps };
