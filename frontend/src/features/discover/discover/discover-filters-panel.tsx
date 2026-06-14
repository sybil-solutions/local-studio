import { QUANTIZATION_TAGS } from "../config";
import { Button, Card, FormField, Select } from "@/ui";

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
    <Card padding="md" className="mb-4">
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Select
          label="Task"
          value={task}
          onChange={(event) => onTaskChange(event.target.value)}
          options={tasks}
        />

        <Select
          label="Provider"
          value={providerFilter}
          onChange={(event) => onProviderFilterChange(event.target.value)}
          options={[
            { value: "", label: "All Providers" },
            ...providers.map((provider) => ({ value: provider, label: provider })),
          ]}
        />

        <Select
          label="Library"
          value={library}
          onChange={(event) => onLibraryChange(event.target.value)}
          options={[
            { value: "", label: "All Libraries" },
            { value: "transformers", label: "Transformers" },
            { value: "pytorch", label: "PyTorch" },
            { value: "safetensors", label: "Safetensors" },
            { value: "gguf", label: "GGUF" },
            { value: "exl2", label: "EXL2" },
            { value: "awq", label: "AWQ" },
            { value: "gptq", label: "GPTQ" },
          ]}
        />

        <Select
          label="Sort By"
          value={sort}
          onChange={(event) => onSortChange(event.target.value)}
          options={sortOptions}
        />
      </div>

      <div className="mt-4">
        <FormField label="Hide Quantization Tags">
          <div className="flex flex-wrap gap-2">
            {QUANTIZATION_TAGS.map((quant) => {
              const tag = quant.toUpperCase();
              const active = excludedQuantizations.includes(tag);
              return (
                <Button
                  key={tag}
                  variant={active ? "danger" : "secondary"}
                  size="sm"
                  onClick={() => toggleQuant(tag)}
                >
                  {tag}
                </Button>
              );
            })}
            {excludedQuantizations.length > 0 && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onExcludedQuantizationsChange([])}
              >
                Clear
              </Button>
            )}
          </div>
        </FormField>
      </div>
    </Card>
  );
}
