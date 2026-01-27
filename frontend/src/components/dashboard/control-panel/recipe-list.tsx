// CRITICAL
"use client";

import { useState, useMemo } from "react";
import type { RecipeWithStatus } from "@/lib/types";

interface RecipeListProps {
  recipes: RecipeWithStatus[];
  launching: boolean;
  onLaunch: (recipeId: string) => Promise<void>;
  onNewRecipe: () => void;
  onViewAll: () => void;
  currentRecipeId?: string;
}

export function RecipeList({
  recipes,
  launching,
  onLaunch,
  onNewRecipe,
  onViewAll,
  currentRecipeId,
}: RecipeListProps) {
  const [filter, setFilter] = useState("");

  const visibleRecipes = useMemo(() => {
    const q = filter.toLowerCase();
    if (!q) return recipes.slice(0, 8);
    return recipes.filter(r => 
      r.name.toLowerCase().includes(q) ||
      r.id.toLowerCase().includes(q)
    ).slice(0, 8);
  }, [recipes, filter]);

  return (
    <div className="min-w-0 overflow-x-hidden">
      <div className="flex items-center justify-between mb-4">
        <div className="text-xs uppercase tracking-widest text-foreground/40">Recipes</div>
        <button 
          onClick={onNewRecipe}
          className="text-xs text-foreground/30 hover:text-foreground/60 transition-colors"
        >
          [+ new]
        </button>
      </div>

      {/* Filter */}
      <input
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="filter..."
        className="w-full mb-3 px-2 py-1 bg-transparent border border-foreground/10 text-sm placeholder:text-foreground/20 focus:outline-none focus:border-foreground/30"
      />

      {/* List */}
      <div className="border border-foreground/10 max-h-[320px] overflow-y-auto">
        {visibleRecipes.map((recipe) => (
          <RecipeItem
            key={recipe.id}
            recipe={recipe}
            isRunning={recipe.status === "running"}
            isCurrent={recipe.id === currentRecipeId}
            disabled={launching || recipe.status === "running"}
            onClick={() => onLaunch(recipe.id)}
          />
        ))}
      </div>

      {recipes.length > 8 && !filter && (
        <button
          onClick={onViewAll}
          className="w-full mt-2 text-xs text-foreground/30 hover:text-foreground/50 transition-colors text-left"
        >
          view all {recipes.length} -
        </button>
      )}
    </div>
  );
}

function RecipeItem({
  recipe,
  isRunning,
  isCurrent,
  disabled,
  onClick
}: {
  recipe: RecipeWithStatus;
  isRunning: boolean;
  isCurrent?: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full text-left px-3 py-2 border-b border-foreground/5 last:border-0 transition-colors overflow-hidden ${
        isCurrent
          ? "bg-(--success)/10 text-(--success)"
          : "hover:bg-foreground/[0.02]"
      } ${disabled && !isRunning ? "opacity-30 cursor-not-allowed" : ""}`}
    >
      <div className="flex items-center justify-between min-w-0 gap-2">
        <span className="text-sm truncate flex-1 min-w-0">{recipe.name}</span>
        <span className="text-xs text-foreground/30 font-mono shrink-0">
          tp{recipe.tp || recipe.tensor_parallel_size}
        </span>
      </div>
      {isRunning && (
        <div className="text-[10px] text-(--success)/60 mt-0.5">running</div>
      )}
    </button>
  );
}
