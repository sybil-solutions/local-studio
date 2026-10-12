"use client";

import { useRef, useState } from "react";
import type { RecipeWithStatus } from "@/lib/types";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { POPOVER_PANEL_CLASS } from "@/ui/popover";

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
        className="h-7 rounded-full bg-(--fg)/5 px-3 text-[length:var(--fs-sm)] text-(--fg)/85 hover:bg-(--fg)/10 hover:text-(--fg)"
      >
        Models ▾
      </button>
      {open ? (
        <div className={`absolute right-0 z-30 mt-1 w-[22rem] ${POPOVER_PANEL_CLASS}`}>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] border-b border-(--border)">
            <input
              autoFocus
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search models…"
              className="min-w-0 bg-transparent px-2.5 py-1.5 text-[length:var(--fs-sm)] text-(--fg) placeholder:text-(--hl2) focus:outline-none"
            />
            {onNewRecipe ? (
              <button
                onClick={() => {
                  setOpen(false);
                  onNewRecipe();
                }}
                className="border-l border-(--border) px-2.5 py-1.5 text-[length:var(--fs-sm)] text-(--dim) hover:bg-(--fg)/5 hover:text-(--fg)"
              >
                + new
              </button>
            ) : null}
          </div>
          <div className="max-h-[18rem] overflow-auto">
            {visible.length === 0 ? (
              <div className="px-2.5 py-2 text-[length:var(--fs-sm)] text-(--dim)">
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
              className="block w-full border-t border-(--border) px-2.5 py-1.5 text-left text-[length:var(--fs-sm)] text-(--dim) hover:bg-(--fg)/5 hover:text-(--fg)"
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
      className={`flex w-full items-center gap-2 border-b border-(--separator) px-2.5 py-1.5 text-left last:border-b-0 ${isCurrent ? "bg-(--fg)/8" : "hover:bg-(--fg)/5"} ${disabled && !isCurrent ? "cursor-not-allowed opacity-30" : ""}`}
    >
      <span
        className={`h-3 w-0.5 shrink-0 ${isCurrent ? "bg-(--fg)" : running ? "bg-(--fg)/60" : "bg-(--dim)/40"}`}
      />
      <span className="flex-1 truncate text-[length:var(--fs-sm)] text-(--fg)" title={recipe.name}>
        {recipe.name}
      </span>
      {running ? <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> : null}
      <span className="text-[length:var(--fs-2xs)] text-(--dim)">
        tp{recipe.tp || recipe.tensor_parallel_size}
      </span>
    </button>
  );
}
