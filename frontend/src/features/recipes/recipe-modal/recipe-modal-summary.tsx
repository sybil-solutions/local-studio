"use client";

import { SegmentedControl, StatusPill, type SegmentedItem } from "@/ui";
import { ModelLogo } from "@/ui/model-logo";
import { modelIdFromPath } from "@/lib/huggingface";
import type { Backend } from "@/lib/types";
import type { RecipeEditor } from "@/features/recipes/recipe-editor";

const BACKEND_ITEMS: SegmentedItem<Backend>[] = [
  { id: "vllm", label: "vLLM" },
  { id: "sglang", label: "SGLang" },
  { id: "exllamav3", label: "exllamav3" },
];

export function RecipeModalSummary({
  recipe,
  backend,
  commandOverridden,
  onBackendChange,
}: {
  recipe: RecipeEditor;
  backend: Backend;
  commandOverridden: boolean;
  onBackendChange: (backend: Backend) => void;
}) {
  return (
    <div className="rounded-md border border-(--ui-border) bg-(--ui-surface) p-3">
      <div className="flex flex-wrap items-start gap-3">
        <ModelLogo
          modelId={recipe.model_path ? modelIdFromPath(recipe.model_path) : "model"}
          size="lg"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[length:var(--fs-md)] font-medium text-(--ui-fg)">
              {recipe.name?.trim() || "Untitled recipe"}
            </span>
            {commandOverridden ? (
              <StatusPill tone="warning" variant="badge" className="shrink-0">
                command override
              </StatusPill>
            ) : null}
          </div>
          <div
            className="mt-0.5 truncate font-mono text-[length:var(--fs-sm)] text-(--ui-muted)"
            title={recipe.model_path || undefined}
          >
            {recipe.model_path || "No model selected"}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="text-[length:var(--fs-sm)] text-(--ui-muted)">
            Engine
          </span>
          <SegmentedControl
            items={BACKEND_ITEMS}
            value={backend}
            onChange={onBackendChange}
            size="sm"
          />
        </div>
      </div>
    </div>
  );
}
