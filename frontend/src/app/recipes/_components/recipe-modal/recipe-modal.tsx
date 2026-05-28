"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
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
  const llamaConfigLoading = isLlamacpp && !llamaConfigHelp;

  const subscribeLlamaConfigHelp = useCallback(
    (_notify: () => void) => {
      if (!isLlamacpp) return () => {};
      if (llamaConfigHelp) return () => {};

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
    },
    [isLlamacpp, llamaConfigHelp],
  );

  useSyncExternalStore(subscribeLlamaConfigHelp, getRecipeModalSnapshot, getRecipeModalSnapshot);

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
    <aside
      className="relative flex shrink-0 flex-col border-l border-(--border) bg-(--bg)"
      style={{ width: "720px", minWidth: "min(420px, 40%)", maxWidth: "min(820px, 65%)" }}
    >
      {/* Header — matches chat sidepanel ComputerHeader (h-9, text-[11px]) */}
      <div className="relative flex h-9 shrink-0 items-center gap-2 border-b border-(--border) px-2 text-[11px]">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-(--surface)">
          <Layers className="h-3 w-3 text-(--accent)/70" />
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate font-medium text-(--fg)/85">
            {recipe.id ? "Edit recipe" : "New recipe"}
          </span>
          <span className="shrink-0 rounded-[5px] bg-(--surface) px-1.5 py-0.5 text-[10px] font-medium text-(--accent)/80">
            {formatBackendLabel(recipe.backend)}
          </span>
        </div>
        <button
          onClick={onClose}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-(--dim)/65 transition-colors hover:bg-(--hover) hover:text-(--fg)/75"
          aria-label="Close recipe drawer"
          title="Close"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      <RecipeModalTabBar activeTab={activeTab} onSelectTab={setActiveTab} />

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <RecipeModalTabContent
          activeTab={activeTab}
          recipe={recipe}
          onChange={onChange}
          availableModels={availableModels}
          modelServedNames={modelServedNames}
          isLlamacpp={isLlamacpp}
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
      <div className="flex h-10 shrink-0 items-center justify-between gap-3 border-t border-(--border) bg-(--bg) px-2 text-[11px]">
        <div className="min-w-0 truncate text-(--dim)/75">
          {recipe.id ? `Editing ${recipe.name}` : "Creating new recipe"}
          {extraArgsError && <span className="ml-3 text-(--err)">Extra args has errors</span>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={onClose}
            disabled={saving}
            className="inline-flex h-7 items-center rounded-md px-2 text-[11px] text-(--dim)/75 transition-colors hover:bg-(--hover) hover:text-(--fg)/85 disabled:opacity-50"
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
            className="inline-flex h-7 items-center gap-1.5 rounded-md bg-(--surface) px-2.5 text-[11px] font-medium text-(--fg)/85 transition-colors hover:bg-(--surface-2) disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? (
              <>
                <RefreshCw className="h-3 w-3 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Save className="h-3 w-3" />
                Save recipe
              </>
            )}
          </button>
        </div>
      </div>
    </aside>
  );
}

const getRecipeModalSnapshot = (): number => 0;
