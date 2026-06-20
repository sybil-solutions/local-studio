import type { EngineCapabilities } from "@/features/recipes/engine-capabilities";
import type { RecipeEditor } from "@/features/recipes/recipe-editor";

/** Props shared by every capability-driven recipe editor section. */
export type RecipeModalSectionProps = {
  recipe: RecipeEditor;
  onChange: (next: RecipeEditor) => void;
  capabilities: EngineCapabilities;
};

/** Props shared by the engine-option-aware recipe editor tabs. */
export type RecipeModalTabProps = RecipeModalSectionProps & {
  getExtraArgValueForKey: (key: string) => unknown;
  setExtraArgValueForKey: (key: string, value: unknown) => void;
};
