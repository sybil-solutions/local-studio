import { useMemo, useState } from "react";
import type { RecipeWithStatus } from "@/lib/types";
import { QuickLaunchHeader } from "./quick-launch-header";
import { QuickLaunchList } from "./quick-launch-list";
import { QuickLaunchSearch } from "./quick-launch-search";

interface QuickLaunchSectionProps {
  recipes: RecipeWithStatus[];
  launching: boolean;
  onLaunch: (recipeId: string) => Promise<void>;
  onNewRecipe: () => void;
  onViewAll: () => void;
}

export function QuickLaunchSection({
  recipes,
  launching,
  onLaunch,
  onNewRecipe,
  onViewAll,
}: QuickLaunchSectionProps) {
  const [expanded, setExpanded] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [];
    return recipes
      .filter(
        (recipe) =>
          recipe.name.toLowerCase().includes(query) ||
          recipe.id.toLowerCase().includes(query) ||
          recipe.model_path.toLowerCase().includes(query),
      )
      .slice(0, 8);
  }, [recipes, searchQuery]);

  const handleLaunch = async (recipeId: string) => {
    await onLaunch(recipeId);
    setSearchQuery("");
  };

  return (
    <section>
      <QuickLaunchHeader expanded={expanded} onToggle={() => setExpanded(!expanded)} onNewRecipe={onNewRecipe} />
      <QuickLaunchSearch value={searchQuery} onChange={setSearchQuery} />
      {expanded && (
        <QuickLaunchList
          recipes={recipes}
          searchResults={searchResults}
          query={searchQuery}
          launching={launching}
          onLaunch={handleLaunch}
          onViewAll={onViewAll}
        />
      )}
    </section>
  );
}
