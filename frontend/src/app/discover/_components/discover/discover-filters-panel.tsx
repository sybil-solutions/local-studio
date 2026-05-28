import { QUANTIZATION_TAGS } from "../config";

export function DiscoverFiltersPanel({
  showFilters,
  task,
  providerFilter,
  providers,
  library,
  sort,
  tasks,
  sortOptions,
  excludedQuantizations,
  onTaskChange,
  onProviderFilterChange,
  onLibraryChange,
  onSortChange,
  onExcludedQuantizationsChange,
}: {
  showFilters: boolean;
  task: string;
  providerFilter: string;
  providers: string[];
  library: string;
  sort: string;
  tasks: Array<{ value: string; label: string }>;
  sortOptions: Array<{ value: string; label: string }>;
  excludedQuantizations: string[];
  onTaskChange: (value: string) => void;
  onProviderFilterChange: (value: string) => void;
  onLibraryChange: (value: string) => void;
  onSortChange: (value: string) => void;
  onExcludedQuantizationsChange: (value: string[]) => void;
}) {
  if (!showFilters) return null;

  const toggleQuant = (quant: string) => {
    const next = new Set(excludedQuantizations);
    if (next.has(quant)) next.delete(quant);
    else next.add(quant);
    onExcludedQuantizationsChange(Array.from(next));
  };

  return (
    <div className="mb-4 p-4 bg-(--surface) border border-(--border) rounded-lg">
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div>
          <label className="block text-xs text-(--dim) mb-1.5">Task</label>
          <select
            value={task}
            onChange={(event) => onTaskChange(event.target.value)}
            className="w-full px-3 py-2 bg-(--bg) border border-(--border) rounded-lg text-sm text-(--fg) focus:outline-none focus:border-(--hl1)"
          >
            {tasks.map((taskOption) => (
              <option key={taskOption.value} value={taskOption.value}>
                {taskOption.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-(--dim) mb-1.5">Provider</label>
          <select
            value={providerFilter}
            onChange={(event) => onProviderFilterChange(event.target.value)}
            className="w-full px-3 py-2 bg-(--bg) border border-(--border) rounded-lg text-sm text-(--fg) focus:outline-none focus:border-(--hl1)"
          >
            <option value="">All Providers</option>
            {providers.map((provider) => (
              <option key={provider} value={provider}>
                {provider}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-(--dim) mb-1.5">Library</label>
          <select
            value={library}
            onChange={(event) => onLibraryChange(event.target.value)}
            className="w-full px-3 py-2 bg-(--bg) border border-(--border) rounded-lg text-sm text-(--fg) focus:outline-none focus:border-(--hl1)"
          >
            <option value="">All Libraries</option>
            <option value="transformers">Transformers</option>
            <option value="pytorch">PyTorch</option>
            <option value="safetensors">Safetensors</option>
            <option value="gguf">GGUF</option>
            <option value="exl2">EXL2</option>
            <option value="awq">AWQ</option>
            <option value="gptq">GPTQ</option>
          </select>
        </div>

        <div>
          <label className="block text-xs text-(--dim) mb-1.5">Sort By</label>
          <select
            value={sort}
            onChange={(event) => onSortChange(event.target.value)}
            className="w-full px-3 py-2 bg-(--bg) border border-(--border) rounded-lg text-sm text-(--fg) focus:outline-none focus:border-(--hl1)"
          >
            {sortOptions.map((sortOption) => (
              <option key={sortOption.value} value={sortOption.value}>
                {sortOption.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4">
        <label className="block text-xs text-(--dim) mb-2">Hide Quantization Tags</label>
        <div className="flex flex-wrap gap-2">
          {QUANTIZATION_TAGS.map((quant) => {
            const tag = quant.toUpperCase();
            const active = excludedQuantizations.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => toggleQuant(tag)}
                className={
                  "px-2.5 py-1 rounded-md border text-xs transition-colors " +
                  (active
                    ? "bg-(--err)/10 border-(--err)/30 text-(--err)"
                    : "bg-(--bg) border-(--border) text-(--dim) hover:text-(--fg)")
                }
              >
                {tag}
              </button>
            );
          })}
          {excludedQuantizations.length > 0 && (
            <button
              type="button"
              onClick={() => onExcludedQuantizationsChange([])}
              className="px-2.5 py-1 rounded-md border text-xs bg-(--bg) border-(--border) text-(--dim) hover:text-(--fg)"
            >
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
