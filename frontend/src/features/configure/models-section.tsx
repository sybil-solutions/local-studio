"use client";

import { useState } from "react";
import Link from "next/link";
import { EmptySafeNotice, ListGroup, SearchInput, StatusPill } from "@/ui";
import { ModelLogo } from "@/ui/model-logo";
import { ArrowRightIcon } from "@/ui/icon-registry";
import { modelIdFromPath } from "@/lib/huggingface";
import type { RecipeWithStatus } from "@/lib/types";
import type { ConfigureState } from "./use-configure";
import { InlineRename } from "./inline-rename";

const recipeFacts = (recipe: RecipeWithStatus): string => {
  const backend = recipe.backend === "llamacpp" ? "llama.cpp" : recipe.backend;
  const servedName = recipe.served_model_name?.trim();
  return servedName ? `${backend} · API name: ${servedName}` : backend;
};

const matchingRecipes = (recipes: RecipeWithStatus[], query: string): RecipeWithStatus[] => {
  const needle = query.trim().toLowerCase();
  return [...recipes]
    .sort(
      (a, b) =>
        Number(b.status === "running") - Number(a.status === "running") ||
        a.name.localeCompare(b.name),
    )
    .filter((recipe) =>
      [recipe.name, recipe.backend, recipe.served_model_name, recipe.model_path]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    );
};

export function ModelsSection({ state }: { state: ConfigureState }) {
  const [query, setQuery] = useState("");
  const recipes = matchingRecipes(state.recipes, query);

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-(--ui-border) bg-(--ui-surface) p-5 sm:flex sm:items-center sm:justify-between sm:gap-5">
        <div>
          <h3 className="text-[length:var(--fs-lg)] font-medium text-(--ui-fg)">
            Launch settings live in Models
          </h3>
          <p className="mt-1 max-w-[34rem] text-[length:var(--fs-sm)] leading-relaxed text-(--ui-muted)">
            This page only changes friendly names. GPU count, engine, quantization, context length,
            and performance tuning stay with each model profile.
          </p>
        </div>
        <Link
          href="/recipes"
          className="mt-4 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-(--ui-border) bg-(--surface-3) px-3 text-[length:var(--fs-sm)] font-medium text-(--ui-fg) transition-colors hover:bg-(--ui-hover) sm:mt-0"
        >
          Open model settings
          <ArrowRightIcon className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="flex items-center justify-between gap-4">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Find a model profile"
          className="w-full max-w-sm"
        />
        <span className="shrink-0 text-[length:var(--fs-xs)] text-(--ui-muted)">
          {recipes.length} of {state.recipes.length}
        </span>
      </div>

      <ListGroup title="Profiles">
        {recipes.map((recipe) => (
          <div
            key={recipe.id}
            className="flex items-center gap-3 px-3.5 py-3 transition-colors hover:bg-(--ui-hover)/35"
          >
            <ModelLogo modelId={modelIdFromPath(recipe.model_path)} size="sm" />
            <div className="min-w-0 flex-1">
              <InlineRename
                value={recipe.name}
                label={`model ${recipe.name}`}
                onRename={(name) => state.renameRecipe(recipe, name)}
                textClassName="text-[length:var(--fs-base)] font-medium text-(--ui-fg)"
              />
              <p className="truncate text-[length:var(--fs-sm)] text-(--ui-muted)">
                {recipeFacts(recipe)}
              </p>
            </div>
            {recipe.status === "running" ? <StatusPill tone="good">running</StatusPill> : null}
          </div>
        ))}
        {recipes.length === 0 ? (
          <EmptySafeNotice>
            {state.recipes.length === 0
              ? "No model profiles yet. Add one from Models and it will appear here."
              : `No model profiles match “${query}”.`}
          </EmptySafeNotice>
        ) : null}
      </ListGroup>
    </div>
  );
}
