import { SearchInput } from "@/ui";

export function DiscoverSearchToolbar({
  search,
  onSearchChange,
}: {
  search: string;
  onSearchChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <SearchInput
        value={search}
        onChange={onSearchChange}
        placeholder="Search models..."
        className="flex-1"
      />
    </div>
  );
}
