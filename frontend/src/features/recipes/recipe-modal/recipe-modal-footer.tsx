"use client";

import { Save } from "@/ui/icon-registry";
import { Button, Spinner } from "@/ui";
import { DrawerFooter } from "@/ui/drawer";
import type { RecipeEditor } from "@/features/recipes/recipe-editor";

export function RecipeModalFooter({
  recipe,
  saving,
  extraArgsError,
  recipeSourceError,
  onClose,
  onSave,
}: {
  recipe: RecipeEditor;
  saving: boolean;
  extraArgsError: string | null;
  recipeSourceError: string | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const invalid =
    Boolean(extraArgsError) ||
    Boolean(recipeSourceError) ||
    !recipe.name.trim() ||
    !recipe.model_path.trim() ||
    !recipe.runtime?.ref.trim();
  return (
    <DrawerFooter
      status={
        <>
          {recipe.id ? `Editing ${recipe.name}` : "Creating a Serve"}
          {extraArgsError ? (
            <span className="ml-3 text-(--ui-danger)">Extra args has errors</span>
          ) : null}
          {recipeSourceError ? (
            <span className="ml-3 text-(--ui-danger)">Serve JSON has errors</span>
          ) : null}
        </>
      }
    >
      <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
        Cancel
      </Button>
      <Button
        size="sm"
        onClick={onSave}
        disabled={saving || invalid}
        icon={saving ? <Spinner size="xs" variant="refresh" /> : <Save className="h-3 w-3" />}
      >
        {saving ? "Saving..." : "Save Serve"}
      </Button>
    </DrawerFooter>
  );
}
