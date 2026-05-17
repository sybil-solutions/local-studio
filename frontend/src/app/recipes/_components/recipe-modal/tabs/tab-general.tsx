// CRITICAL
"use client";

import { Info, Server } from "lucide-react";
import type { ModelInfo, RecipeEditor } from "@/lib/types";

export function RecipeModalTabGeneral({
  recipe,
  onChange,
  availableModels,
  modelServedNames,
}: {
  recipe: RecipeEditor;
  onChange: (next: RecipeEditor) => void;
  availableModels: ModelInfo[];
  modelServedNames: Record<string, string>;
}) {
  return (
    <div className="space-y-5">
      {/* Basic Info */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-(--fg) pb-2 border-b border-(--border)/50">
          <Info className="w-4 h-4 text-(--accent)" />
          <span className="text-sm font-medium">Basic Information</span>
        </div>

        <div>
          <label className="block text-xs font-medium text-(--dim) uppercase tracking-wider mb-2">
            Recipe Name <span className="text-(--accent)">*</span>
          </label>
          <input
            type="text"
            value={recipe.name ?? ""}
            onChange={(e) => onChange({ ...recipe, name: e.target.value })}
            placeholder="e.g., Llama 3.1 8B Instruct"
            className="w-full px-3 py-2.5 bg-(--bg) border border-(--border) rounded-md text-sm focus:outline-none focus:border-(--accent) focus:ring-1 focus:ring-(--accent)/20 transition-all"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-(--dim) uppercase tracking-wider mb-2">
            Model Path <span className="text-(--accent)">*</span>
          </label>
          <select
            value={recipe.model_path ?? ""}
            onChange={(e) => onChange({ ...recipe, model_path: e.target.value })}
            className="w-full px-3 py-2.5 bg-(--bg) border border-(--border) rounded-md text-sm focus:outline-none focus:border-(--accent) focus:ring-1 focus:ring-(--accent)/20 transition-all"
          >
            <option value="">Select a model...</option>
            {availableModels.map((model) => {
              const servedName = modelServedNames[model.path];
              return (
                <option key={model.path} value={model.path}>
                  {servedName ? `${servedName} (${model.name})` : model.name}
                </option>
              );
            })}
          </select>
          {recipe.model_path && !availableModels.some((m) => m.path === recipe.model_path) && (
            <p className="mt-1.5 text-xs text-(--dim)">Custom: {recipe.model_path}</p>
          )}
        </div>
      </div>

      {/* Server Config */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-(--fg) pb-2 border-b border-(--border)/50">
          <Server className="w-4 h-4 text-(--accent)" />
          <span className="text-sm font-medium">Server Configuration</span>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-(--dim) mb-2">Backend</label>
            <select
              value={recipe.backend ?? "vllm"}
              onChange={(e) =>
                onChange({
                  ...recipe,
                  backend: e.target.value as "vllm" | "sglang" | "llamacpp" | "ds4",
                })
              }
              className="w-full px-3 py-2 bg-(--bg) border border-(--border) rounded-md text-sm focus:outline-none focus:border-(--accent)"
            >
              <option value="vllm">vLLM</option>
              <option value="sglang">SGLang</option>
              <option value="llamacpp">llama.cpp</option>
              <option value="ds4">DS4</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-(--dim) mb-2">Host</label>
            <input
              type="text"
              value={recipe.host ?? "0.0.0.0"}
              onChange={(e) => onChange({ ...recipe, host: e.target.value || undefined })}
              placeholder="0.0.0.0"
              className="w-full px-3 py-2 bg-(--bg) border border-(--border) rounded-md text-sm focus:outline-none focus:border-(--accent)"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-(--dim) mb-2">Port</label>
            <input
              type="number"
              value={recipe.port ?? 8000}
              onChange={(e) => onChange({ ...recipe, port: Number(e.target.value) })}
              className="w-full px-3 py-2 bg-(--bg) border border-(--border) rounded-md text-sm focus:outline-none focus:border-(--accent)"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-(--dim) mb-2">
            Served Model Name (Optional)
          </label>
          <input
            type="text"
            value={recipe.served_model_name || ""}
            onChange={(e) =>
              onChange({ ...recipe, served_model_name: e.target.value || undefined })
            }
            placeholder="Custom name exposed in API"
            className="w-full px-3 py-2 bg-(--bg) border border-(--border) rounded-md text-sm focus:outline-none focus:border-(--accent)"
          />
        </div>
      </div>
    </div>
  );
}
