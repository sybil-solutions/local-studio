"use client";

import { Layers } from "lucide-react";
import type { RecipeEditor } from "@/lib/types";
import { LlamacppOptionsSection } from "../llamacpp-options-section";

export function RecipeModalTabModel({
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
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-(--fg) pb-2 border-b border-(--border)/50">
            <Layers className="w-4 h-4 text-(--accent)" />
            <span className="text-sm font-medium">Model & Context</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-(--dim) mb-2">Context Size</label>
              <input
                type="number"
                value={recipe.max_model_len || ""}
                onChange={(e) =>
                  onChange({ ...recipe, max_model_len: Number(e.target.value) || undefined })
                }
                placeholder="8192"
                className="w-full px-3 py-2 bg-(--bg) border border-(--border) rounded-md text-sm focus:outline-none focus:border-(--accent)"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-(--dim) mb-2">Seed</label>
              <input
                type="number"
                value={recipe.seed || ""}
                onChange={(e) => onChange({ ...recipe, seed: Number(e.target.value) || undefined })}
                placeholder="Random"
                className="w-full px-3 py-2 bg-(--bg) border border-(--border) rounded-md text-sm focus:outline-none focus:border-(--accent)"
              />
            </div>
          </div>
        </div>

        <LlamacppOptionsSection
          tab="model"
          getValueForKey={getExtraArgValueForKey}
          setValueForKey={setExtraArgValueForKey}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Model Loading */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-(--fg) pb-2 border-b border-(--border)/50">
          <Layers className="w-4 h-4 text-(--accent)" />
          <span className="text-sm font-medium">Model Loading</span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-(--dim) mb-2">Max Model Length</label>
            <input
              type="number"
              value={recipe.max_model_len || ""}
              onChange={(e) =>
                onChange({ ...recipe, max_model_len: Number(e.target.value) || undefined })
              }
              placeholder="32768"
              className="w-full px-3 py-2 bg-(--bg) border border-(--border) rounded-md text-sm focus:outline-none focus:border-(--accent)"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-(--dim) mb-2">Seed</label>
            <input
              type="number"
              value={recipe.seed || ""}
              onChange={(e) => onChange({ ...recipe, seed: Number(e.target.value) || undefined })}
              placeholder="Random"
              className="w-full px-3 py-2 bg-(--bg) border border-(--border) rounded-md text-sm focus:outline-none focus:border-(--accent)"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-(--dim) mb-2">Tokenizer</label>
            <input
              type="text"
              value={recipe.tokenizer || ""}
              onChange={(e) => onChange({ ...recipe, tokenizer: e.target.value || undefined })}
              placeholder="Path or name"
              className="w-full px-3 py-2 bg-(--bg) border border-(--border) rounded-md text-sm focus:outline-none focus:border-(--accent)"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-(--dim) mb-2">Tokenizer Mode</label>
            <select
              value={recipe.tokenizer_mode || "auto"}
              onChange={(e) =>
                onChange({
                  ...recipe,
                  tokenizer_mode:
                    e.target.value === "auto"
                      ? undefined
                      : (e.target.value as "auto" | "slow" | "mistral"),
                })
              }
              className="w-full px-3 py-2 bg-(--bg) border border-(--border) rounded-md text-sm focus:outline-none focus:border-(--accent)"
            >
              <option value="auto">Auto</option>
              <option value="slow">Slow</option>
              <option value="mistral">Mistral</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-(--dim) mb-2">Revision</label>
            <input
              type="text"
              value={recipe.revision || ""}
              onChange={(e) => onChange({ ...recipe, revision: e.target.value || undefined })}
              placeholder="e.g., main"
              className="w-full px-3 py-2 bg-(--bg) border border-(--border) rounded-md text-sm focus:outline-none focus:border-(--accent)"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-(--dim) mb-2">Code Revision</label>
            <input
              type="text"
              value={recipe.code_revision || ""}
              onChange={(e) => onChange({ ...recipe, code_revision: e.target.value || undefined })}
              placeholder="Optional"
              className="w-full px-3 py-2 bg-(--bg) border border-(--border) rounded-md text-sm focus:outline-none focus:border-(--accent)"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-(--dim) mb-2">Load Format</label>
            <input
              type="text"
              value={recipe.load_format || ""}
              onChange={(e) => onChange({ ...recipe, load_format: e.target.value || undefined })}
              placeholder="auto, safetensors"
              className="w-full px-3 py-2 bg-(--bg) border border-(--border) rounded-md text-sm focus:outline-none focus:border-(--accent)"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-(--dim) mb-2">Quantization</label>
            <input
              type="text"
              value={recipe.quantization || ""}
              onChange={(e) => onChange({ ...recipe, quantization: e.target.value || undefined })}
              placeholder="awq, gptq, fp8"
              className="w-full px-3 py-2 bg-(--bg) border border-(--border) rounded-md text-sm focus:outline-none focus:border-(--accent)"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-(--dim) mb-2">
            Quantization Param Path
          </label>
          <input
            type="text"
            value={recipe.quantization_param_path || ""}
            onChange={(e) =>
              onChange({ ...recipe, quantization_param_path: e.target.value || undefined })
            }
            placeholder="Path to calibration file"
            className="w-full px-3 py-2 bg-(--bg) border border-(--border) rounded-md text-sm focus:outline-none focus:border-(--accent)"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-(--dim) mb-2">Dtype</label>
            <select
              value={recipe.dtype || "auto"}
              onChange={(e) =>
                onChange({
                  ...recipe,
                  dtype: e.target.value === "auto" ? undefined : e.target.value,
                })
              }
              className="w-full px-3 py-2 bg-(--bg) border border-(--border) rounded-md text-sm focus:outline-none focus:border-(--accent)"
            >
              <option value="auto">Auto</option>
              <option value="float16">float16</option>
              <option value="bfloat16">bfloat16</option>
              <option value="float32">float32</option>
            </select>
          </div>
          <div className="flex items-center pt-6">
            <label className="flex items-center gap-2 text-sm text-(--dim) cursor-pointer hover:text-(--fg) transition-colors">
              <input
                type="checkbox"
                checked={recipe.trust_remote_code || false}
                onChange={(e) => onChange({ ...recipe, trust_remote_code: e.target.checked })}
                className="rounded border-(--border) bg-(--bg) w-4 h-4"
              />
              Trust Remote Code
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
