"use client";

import { useRef, useState } from "react";
import type { RecipeWithStatus } from "@/lib/types";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

export function ModelsDropdown({
  recipes,
  currentRecipeId,
  lifecycleStatus,
  onLaunch,
  onNewRecipe,
  onViewAll,
}: {
  recipes: RecipeWithStatus[];
  currentRecipeId?: string;
  lifecycleStatus: "idle" | "starting" | "ready" | "error";
  onLaunch: (id: string) => Promise<void>;
  onNewRecipe?: () => void;
  onViewAll?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const ref = useRef<HTMLDivElement | null>(null);

  useMountSubscription(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const q = filter.toLowerCase();
  const filtered = q
    ? recipes.filter((r) => r.name.toLowerCase().includes(q) || r.id.toLowerCase().includes(q))
    : recipes;
  const visible = filtered.slice(0, q ? 8 : 6);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="h-7 rounded-[var(--rad-2xs)] border border-(--border)/70 px-2.5 font-mono text-[length:var(--fs-xs)] uppercase tracking-[0.12em] text-(--fg) hover:border-(--border) hover:bg-(--fg)/5"
      >
        Models ▾
      </button>
      {open ? (
        <div className="absolute right-0 z-30 mt-1 w-[22rem] rounded-[var(--rad-xs)] border border-(--color-popover-border) bg-(--color-popover) shadow-[0_16px_44px_rgba(0,0,0,0.48)]">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] border-b border-(--border)">
            <input
              autoFocus
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search models…"
              className="min-w-0 bg-transparent px-2.5 py-1.5 font-mono text-xs text-(--fg) placeholder:text-(--dim)/60 focus:outline-none"
            />
            {onNewRecipe ? (
              <button
                onClick={() => {
                  setOpen(false);
                  onNewRecipe();
                }}
                className="border-l border-(--border) px-2.5 py-1.5 font-mono text-[length:var(--fs-xs)] uppercase tracking-[0.12em] text-(--dim) hover:bg-(--fg)/5 hover:text-(--fg)"
              >
                + new
              </button>
            ) : null}
          </div>
          <div className="max-h-[18rem] overflow-auto">
            {visible.length === 0 ? (
              <div className="px-2.5 py-2 font-mono text-[length:var(--fs-xs)] text-(--dim)">
                No models found.
              </div>
            ) : null}
            {visible.map((recipe) => (
              <ModelDropdownRow
                key={recipe.id}
                currentRecipeId={currentRecipeId}
                lifecycleStatus={lifecycleStatus}
                onLaunch={onLaunch}
                recipe={recipe}
                setOpen={setOpen}
              />
            ))}
          </div>
          {onViewAll && filtered.length > visible.length ? (
            <button
              onClick={() => {
                setOpen(false);
                onViewAll();
              }}
              className="block w-full border-t border-(--border) px-2.5 py-1.5 text-left font-mono text-[length:var(--fs-xs)] text-(--dim) hover:bg-(--fg)/5 hover:text-(--fg)"
            >
              {filter
                ? `${filtered.length - visible.length} more →`
                : `View all ${recipes.length} →`}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ModelDropdownRow({
  currentRecipeId,
  lifecycleStatus,
  onLaunch,
  recipe,
  setOpen,
}: {
  currentRecipeId?: string;
  lifecycleStatus: "idle" | "starting" | "ready" | "error";
  onLaunch: (id: string) => Promise<void>;
  recipe: RecipeWithStatus;
  setOpen: (open: boolean) => void;
}) {
  const isCurrent = recipe.id === currentRecipeId;
  const running = recipe.status === "running";
  const disabled = lifecycleStatus === "starting" || isCurrent;
  return (
    <button
      disabled={disabled}
      onClick={async () => {
        setOpen(false);
        await onLaunch(recipe.id);
      }}
      className={`flex w-full items-center gap-2 border-b border-(--border)/60 px-2.5 py-1.5 text-left last:border-b-0 ${isCurrent ? "bg-(--fg)/8" : "hover:bg-(--fg)/5"} ${disabled && !isCurrent ? "cursor-not-allowed opacity-30" : ""}`}
    >
      <span
        className={`h-3 w-0.5 shrink-0 ${isCurrent ? "bg-(--fg)" : running ? "bg-(--fg)/60" : "bg-(--dim)/40"}`}
      />
      <span className="flex-1 truncate font-mono text-xs text-(--fg)" title={recipe.name}>
        {recipe.name}
      </span>
      {running ? <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> : null}
      <span className="font-mono text-[length:var(--fs-2xs)] uppercase tracking-[0.12em] text-(--dim)">
        tp{recipe.tp || recipe.tensor_parallel_size}
      </span>
    </button>
  );
}
