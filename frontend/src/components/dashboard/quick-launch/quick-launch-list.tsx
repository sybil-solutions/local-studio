import type { RecipeWithStatus } from "@/lib/types";
import { QuickLaunchRow } from "./quick-launch-row";

interface QuickLaunchListProps {
  recipes: RecipeWithStatus[];
  searchResults: RecipeWithStatus[];
  query: string;
  launching: boolean;
  onLaunch: (recipeId: string) => void;
  onViewAll: () => void;
}

export function QuickLaunchList({
  recipes,
  searchResults,
  query,
  launching,
  onLaunch,
  onViewAll,
}: QuickLaunchListProps) {
  if (query.trim()) {
    if (searchResults.length === 0) {
      return <p className="text-xs text-(--muted-foreground)/40 py-2">No recipes found</p>;
    }
    return (
      <div className="space-y-0.5">
        {searchResults.map((recipe) => (
          <QuickLaunchRow key={recipe.id} recipe={recipe} launching={launching} onClick={onLaunch} />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {recipes.slice(0, 8).map((recipe) => (
        <QuickLaunchRow key={recipe.id} recipe={recipe} launching={launching} onClick={onLaunch} />
      ))}
      {recipes.length > 8 && (
        <button
          onClick={onViewAll}
          className="w-full py-2 text-[10px] text-(--muted-foreground)/40 hover:text-(--foreground)/60 transition-colors"
        >
          View all {recipes.length} recipes →
        </button>
      )}
    </div>
  );
}
