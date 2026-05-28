"use client";

import { Zap } from "lucide-react";
import type { RecipeEditor } from "@/lib/types";

export function CudaGraphsSection({
  recipe,
  onChange,
}: {
  recipe: RecipeEditor;
  onChange: (next: RecipeEditor) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-(--fg) pb-2 border-b border-(--border)/50">
        <Zap className="w-4 h-4 text-(--accent)" />
        <span className="text-sm font-medium">CUDA Graphs & Compilation</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex items-center gap-3 p-3 bg-(--bg) border border-(--border) rounded-md">
          <input
            type="checkbox"
            id="enforce_eager"
            checked={recipe.enforce_eager || false}
            onChange={(e) => onChange({ ...recipe, enforce_eager: e.target.checked })}
            className="rounded border-(--border) bg-(--surface) w-4 h-4"
          />
          <div className="flex-1">
            <label
              htmlFor="enforce_eager"
              className="text-sm font-medium text-(--fg) cursor-pointer"
            >
              Enforce Eager Mode
            </label>
            <p className="text-xs text-(--dim)">Disables CUDA graphs for debugging</p>
          </div>
        </div>

        <div className="flex items-center gap-3 p-3 bg-(--bg) border border-(--border) rounded-md">
          <input
            type="checkbox"
            id="disable_cuda_graph"
            checked={recipe.disable_cuda_graph || false}
            onChange={(e) => onChange({ ...recipe, disable_cuda_graph: e.target.checked })}
            className="rounded border-(--border) bg-(--surface) w-4 h-4"
          />
          <div className="flex-1">
            <label
              htmlFor="disable_cuda_graph"
              className="text-sm font-medium text-(--fg) cursor-pointer"
            >
              Disable CUDA Graph
            </label>
            <p className="text-xs text-(--dim)">Skip graph capture for dynamic shapes</p>
          </div>
        </div>

        <div className="flex items-center gap-3 p-3 bg-(--bg) border border-(--border) rounded-md">
          <input
            type="checkbox"
            id="use_v2_block_manager"
            checked={recipe.use_v2_block_manager || false}
            onChange={(e) => onChange({ ...recipe, use_v2_block_manager: e.target.checked })}
            className="rounded border-(--border) bg-(--surface) w-4 h-4"
          />
          <div className="flex-1">
            <label
              htmlFor="use_v2_block_manager"
              className="text-sm font-medium text-(--fg) cursor-pointer"
            >
              v2 Block Manager
            </label>
            <p className="text-xs text-(--dim)">New memory management</p>
          </div>
        </div>

        <div className="flex items-center gap-3 p-3 bg-(--bg) border border-(--border) rounded-md">
          <input
            type="checkbox"
            id="disable_custom_all_reduce"
            checked={recipe.disable_custom_all_reduce || false}
            onChange={(e) => onChange({ ...recipe, disable_custom_all_reduce: e.target.checked })}
            className="rounded border-(--border) bg-(--surface) w-4 h-4"
          />
          <div className="flex-1">
            <label
              htmlFor="disable_custom_all_reduce"
              className="text-sm font-medium text-(--fg) cursor-pointer"
            >
              Disable Custom AllReduce
            </label>
            <p className="text-xs text-(--dim)">Use default NCCL collectives</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-(--dim) mb-2">
            CUDA Graph Max Batch Size
          </label>
          <input
            type="number"
            value={recipe.cuda_graph_max_bs || ""}
            onChange={(e) =>
              onChange({ ...recipe, cuda_graph_max_bs: Number(e.target.value) || undefined })
            }
            placeholder="Default"
            className="w-full px-3 py-2 bg-(--bg) border border-(--border) rounded-md text-sm focus:outline-none focus:border-(--accent)"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-(--dim) mb-2">Compilation Config</label>
          <input
            type="text"
            value={recipe.compilation_config || ""}
            onChange={(e) =>
              onChange({ ...recipe, compilation_config: e.target.value || undefined })
            }
            placeholder={`e.g., {\"level\": 3}`}
            className="w-full px-3 py-2 bg-(--bg) border border-(--border) rounded-md text-sm focus:outline-none focus:border-(--accent)"
          />
        </div>
      </div>
    </div>
  );
}
