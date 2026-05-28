"use client";

import { Clock, Database } from "lucide-react";
import type { RecipeEditor } from "@/lib/types";
import { LlamacppOptionsSection } from "../llamacpp-options-section";
import { CudaGraphsSection } from "./tab-performance/cuda-graphs-section";

export function RecipeModalTabPerformance({
  recipe,
  onChange,
  isLlamacpp,
  getExtraArgValueForKey,
  setExtraArgValueForKey,
}: {
  recipe: RecipeEditor;
  onChange: (next: RecipeEditor) => void;
  isLlamacpp: boolean;
  getExtraArgValueForKey: (key: string) => unknown;
  setExtraArgValueForKey: (key: string, value: unknown) => void;
}) {
  if (isLlamacpp) {
    return (
      <div className="space-y-5">
        <LlamacppOptionsSection
          tab="performance"
          getValueForKey={getExtraArgValueForKey}
          setValueForKey={setExtraArgValueForKey}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* CUDA Graphs */}
      <CudaGraphsSection recipe={recipe} onChange={onChange} />

      {/* KV Cache */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-(--fg) pb-2 border-b border-(--border)/50">
          <Database className="w-4 h-4 text-(--accent)" />
          <span className="text-sm font-medium">KV Cache & Memory</span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-(--dim) mb-2">KV Cache Dtype</label>
            <select
              value={recipe.kv_cache_dtype || "auto"}
              onChange={(e) =>
                onChange({
                  ...recipe,
                  kv_cache_dtype: e.target.value === "auto" ? undefined : e.target.value,
                })
              }
              className="w-full px-3 py-2 bg-(--bg) border border-(--border) rounded-md text-sm focus:outline-none focus:border-(--accent)"
            >
              <option value="auto">Auto</option>
              <option value="fp8">FP8</option>
              <option value="fp8_e5m2">FP8 E5M2</option>
              <option value="fp8_e4m3">FP8 E4M3</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-(--dim) mb-2">Block Size</label>
            <select
              value={recipe.block_size || "16"}
              onChange={(e) =>
                onChange({ ...recipe, block_size: Number(e.target.value) || undefined })
              }
              className="w-full px-3 py-2 bg-(--bg) border border-(--border) rounded-md text-sm focus:outline-none focus:border-(--accent)"
            >
              <option value="8">8</option>
              <option value="16">16</option>
              <option value="32">32</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center gap-3 p-3 bg-(--bg) border border-(--border) rounded-md">
            <input
              type="checkbox"
              id="enable_prefix_caching"
              checked={recipe.enable_prefix_caching || false}
              onChange={(e) => onChange({ ...recipe, enable_prefix_caching: e.target.checked })}
              className="rounded border-(--border) bg-(--surface) w-4 h-4"
            />
            <div className="flex-1">
              <label
                htmlFor="enable_prefix_caching"
                className="text-sm font-medium text-(--fg) cursor-pointer"
              >
                Prefix Caching
              </label>
              <p className="text-xs text-(--dim)">Cache shared prefixes</p>
            </div>
          </div>

          <div className="flex items-center gap-3 p-3 bg-(--bg) border border-(--border) rounded-md">
            <input
              type="checkbox"
              id="enable_chunked_prefill"
              checked={recipe.enable_chunked_prefill || false}
              onChange={(e) => onChange({ ...recipe, enable_chunked_prefill: e.target.checked })}
              className="rounded border-(--border) bg-(--surface) w-4 h-4"
            />
            <div className="flex-1">
              <label
                htmlFor="enable_chunked_prefill"
                className="text-sm font-medium text-(--fg) cursor-pointer"
              >
                Chunked Prefill
              </label>
              <p className="text-xs text-(--dim)">Interleave prefill/decode</p>
            </div>
          </div>
        </div>
      </div>

      {/* Scheduling */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-(--fg) pb-2 border-b border-(--border)/50">
          <Clock className="w-4 h-4 text-(--accent)" />
          <span className="text-sm font-medium">Scheduler & Batching</span>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-(--dim) mb-2">Max Sequences</label>
            <input
              type="number"
              value={recipe.max_num_seqs || ""}
              onChange={(e) =>
                onChange({ ...recipe, max_num_seqs: Number(e.target.value) || undefined })
              }
              placeholder="256"
              className="w-full px-3 py-2 bg-(--bg) border border-(--border) rounded-md text-sm focus:outline-none focus:border-(--accent)"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-(--dim) mb-2">
              Max Batched Tokens
            </label>
            <input
              type="number"
              value={recipe.max_num_batched_tokens || ""}
              onChange={(e) =>
                onChange({ ...recipe, max_num_batched_tokens: Number(e.target.value) || undefined })
              }
              placeholder="Auto"
              className="w-full px-3 py-2 bg-(--bg) border border-(--border) rounded-md text-sm focus:outline-none focus:border-(--accent)"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-(--dim) mb-2">Max Paddings</label>
            <input
              type="number"
              value={recipe.max_paddings || ""}
              onChange={(e) =>
                onChange({ ...recipe, max_paddings: Number(e.target.value) || undefined })
              }
              placeholder="Auto"
              className="w-full px-3 py-2 bg-(--bg) border border-(--border) rounded-md text-sm focus:outline-none focus:border-(--accent)"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-(--dim) mb-2">Scheduling Policy</label>
          <select
            value={recipe.scheduling_policy || ""}
            onChange={(e) =>
              onChange({
                ...recipe,
                scheduling_policy: e.target.value
                  ? (e.target.value as "fcfs" | "priority")
                  : undefined,
              })
            }
            className="w-full px-3 py-2 bg-(--bg) border border-(--border) rounded-md text-sm focus:outline-none focus:border-(--accent)"
          >
            <option value="">Default</option>
            <option value="fcfs">FCFS (First Come First Serve)</option>
            <option value="priority">Priority</option>
          </select>
        </div>
      </div>
    </div>
  );
}
