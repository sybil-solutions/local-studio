// CRITICAL
"use client";

import { useEffect, useMemo, useState } from "react";
import { Layers, RefreshCw, Save, X } from "lucide-react";
import api from "@/lib/api";
import type { ModelInfo, RecipeEditor, RecipeWithStatus } from "@/lib/types";
import { formatBackendLabel } from "../../recipe-labels";
import { generateCommand } from "../../recipe-command";
import {
  filterExtraArgsForEditor,
  getExtraArgValueForKey,
  mergeExtraArgsFromEditor,
  setExtraArgValueForKey,
} from "../../recipe-utils";
import { RecipeModalTabBar } from "./recipe-modal-tab-bar";
import type { RecipeModalTabId } from "./tabs/tab-id";
import { RecipeModalTabContent } from "./tabs/tab-content";

export function RecipeModal({
  recipe,
  onClose,
  onSave,
  onChange,
  saving,
  availableModels,
  recipes,
}: {
  recipe: RecipeEditor;
  onClose: () => void;
  onSave: () => void;
  onChange: (recipe: RecipeEditor) => void;
  saving: boolean;
  availableModels: ModelInfo[];
  recipes: RecipeWithStatus[];
}) {
  const [activeTab, setActiveTab] = useState<RecipeModalTabId>("general");
  const [editedCommand, setEditedCommand] = useState<string | null>(null);
  const [extraArgsText, setExtraArgsText] = useState(() =>
    JSON.stringify(filterExtraArgsForEditor(recipe.extra_args ?? {}), null, 2),
  );
  const [extraArgsError, setExtraArgsError] = useState<string | null>(null);
  const [envVarEntries, setEnvVarEntries] = useState(() => {
    const entries = Object.entries(recipe.env_vars ?? {}).map(([key, value]) => ({
      key,
      value: String(value),
    }));
    return entries.length ? entries : [{ key: "", value: "" }];
  });
  const [llamaConfigHelp, setLlamaConfigHelp] = useState<{
    config: string | null;
    error?: string | null;
  } | null>(null);

  const backend = recipe.backend ?? "vllm";
  const isLlamacpp = backend === "llamacpp";
  const isDs4 = backend === "ds4";
  const llamaConfigLoading = isLlamacpp && !llamaConfigHelp;

  useEffect(() => {
    if (!isLlamacpp) return;
    if (llamaConfigHelp) return;

    let cancelled = false;
    api
      .getLlamacppRuntimeConfig()
      .then((result) => {
        if (!cancelled) setLlamaConfigHelp(result);
      })
      .catch((error) => {
        if (!cancelled) setLlamaConfigHelp({ config: null, error: (error as Error).message });
      });

    return () => {
      cancelled = true;
    };
  }, [isLlamacpp, llamaConfigHelp]);

  const getExtraArgValueForKeyLocal = (key: string): unknown => {
    return getExtraArgValueForKey(recipe.extra_args ?? {}, key);
  };

  const setExtraArgValueForKeyLocal = (key: string, value: unknown) => {
    const nextExtraArgs = setExtraArgValueForKey(recipe.extra_args ?? {}, key, value);
    onChange({ ...recipe, extra_args: nextExtraArgs });
  };

  const modelServedNames = useMemo(() => {
    const lookup: Record<string, string> = {};
    for (const r of recipes) {
      if (r.model_path && r.served_model_name && !lookup[r.model_path]) {
        lookup[r.model_path] = r.served_model_name;
      }
    }
    return lookup;
  }, [recipes]);

  const generatedCommand = useMemo(() => generateCommand(recipe), [recipe]);
  const commandText = editedCommand ?? generatedCommand;

  const handleCommandChange = (value: string) => {
    setEditedCommand(value);
    const nextExtraArgs = { ...(recipe.extra_args ?? {}) };
    if (value.trim()) {
      nextExtraArgs["launch_command"] = value;
    } else {
      delete nextExtraArgs["launch_command"];
    }
    onChange({ ...recipe, extra_args: nextExtraArgs });
  };

  const handleExtraArgsChange = (value: string) => {
    setExtraArgsText(value);
    if (!value.trim()) {
      const merged = mergeExtraArgsFromEditor(recipe.extra_args ?? {}, {});
      onChange({ ...recipe, extra_args: merged });
      setExtraArgsError(null);
      return;
    }
    try {
      const parsed = JSON.parse(value) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setExtraArgsError("Extra args must be a JSON object.");
        return;
      }
      const merged = mergeExtraArgsFromEditor(
        recipe.extra_args ?? {},
        parsed as Record<string, unknown>,
      );
      onChange({ ...recipe, extra_args: merged });
      setExtraArgsError(null);
    } catch {
      setExtraArgsError("Extra args must be valid JSON.");
    }
  };

  const updateEnvVarEntries = (nextEntries: Array<{ key: string; value: string }>) => {
    setEnvVarEntries(nextEntries);
    const envVars = nextEntries.reduce<Record<string, string>>((acc, entry) => {
      const key = entry.key.trim();
      if (key) {
        acc[key] = entry.value;
      }
      return acc;
    }, {});
    onChange({ ...recipe, env_vars: Object.keys(envVars).length ? envVars : undefined });
  };

  const handleEnvVarChange = (index: number, field: "key" | "value", value: string) => {
    const next = envVarEntries.map((entry, idx) =>
      idx === index ? { ...entry, [field]: value } : entry,
    );
    updateEnvVarEntries(next);
  };

  const handleAddEnvVar = () => {
    updateEnvVarEntries([...envVarEntries, { key: "", value: "" }]);
  };

  const handleRemoveEnvVar = (index: number) => {
    const next = envVarEntries.filter((_, idx) => idx !== index);
    updateEnvVarEntries(next.length ? next : [{ key: "", value: "" }]);
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <button className="flex-1 bg-black/50" onClick={onClose} aria-label="Close" />

      {/* Drawer */}
      <div className="flex h-full w-full max-w-[720px] animate-in flex-col border-l border-(--border) bg-(--bg) slide-in-from-right duration-200">
        {/* Header */}
        <div className="flex min-h-14 shrink-0 items-center justify-between border-b border-(--border) bg-(--bg) px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-(--surface)">
              <Layers className="h-4 w-4 text-(--accent)" />
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-[15px] font-semibold tracking-[-0.01em] text-(--fg)">
                {recipe.id ? "Edit Recipe" : "New Recipe"}
              </h3>
              <div className="flex items-center gap-2 text-xs text-(--dim)">
                <span>Engine</span>
                <span className="rounded-[5px] bg-(--surface) px-1.5 py-0.5 text-[10px] font-medium text-(--accent)">
                  {formatBackendLabel(recipe.backend)}
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-(--dim) transition-colors hover:bg-(--hover) hover:text-(--fg)"
            aria-label="Close recipe drawer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <RecipeModalTabBar activeTab={activeTab} onSelectTab={setActiveTab} />

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          <RecipeModalTabContent
            activeTab={activeTab}
            recipe={recipe}
            onChange={onChange}
            availableModels={availableModels}
            modelServedNames={modelServedNames}
            isLlamacpp={isLlamacpp}
            isDs4={isDs4}
            getExtraArgValueForKey={getExtraArgValueForKeyLocal}
            setExtraArgValueForKey={setExtraArgValueForKeyLocal}
            envVarEntries={envVarEntries}
            onAddEnvVar={handleAddEnvVar}
            onChangeEnvVar={handleEnvVarChange}
            onRemoveEnvVar={handleRemoveEnvVar}
            extraArgsText={extraArgsText}
            extraArgsError={extraArgsError}
            onExtraArgsChange={handleExtraArgsChange}
            llamaConfigLoading={llamaConfigLoading}
            llamaConfigHelp={llamaConfigHelp}
            commandText={commandText}
            onCommandChange={handleCommandChange}
          />
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-(--border) bg-(--bg) px-4 py-3">
          <div className="text-xs text-(--dim)">
            {recipe.id ? `Editing ${recipe.name}` : "Creating new recipe"}
            {extraArgsError && <span className="ml-3 text-(--err)">Extra args has errors</span>}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={saving}
              className="inline-flex h-8 items-center rounded-md px-3 text-[12px] text-(--dim) transition-colors hover:bg-(--hover) hover:text-(--fg) disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={onSave}
              disabled={
                saving ||
                !!extraArgsError ||
                !(recipe.name ?? "").trim() ||
                !(recipe.model_path ?? "").trim()
              }
              className="inline-flex h-8 items-center gap-2 rounded-md bg-(--surface) px-3 text-[12px] font-medium text-(--fg) transition-colors hover:bg-(--surface-2) disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-3.5 w-3.5" />
                  Save Recipe
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
