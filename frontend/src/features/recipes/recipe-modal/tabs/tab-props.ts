import type { EngineCapabilities } from "@/features/recipes/engine-capabilities";
import type { RecipeEditor } from "@/features/recipes/recipe-editor";

/** Props shared by every capability-driven recipe editor tab. */
export type RecipeModalTabProps = {
  recipe: RecipeEditor;
  onChange: (next: RecipeEditor) => void;
  capabilities: EngineCapabilities;
  getExtraArgValueForKey: (key: string) => unknown;
  setExtraArgValueForKey: (key: string, value: unknown) => void;
};
