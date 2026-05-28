"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { RefreshCw, Save, X } from "lucide-react";
import { Button, StatusPill } from "@/ui";
import api from "@/lib/api";
import type { ModelInfo, RecipeEditor, RecipeWithStatus } from "@/lib/types";
import { formatBackendLabel } from "@/lib/recipes/recipe-labels";
import { generateCommand } from "@/lib/recipes/recipe-command";
import {
  filterExtraArgsForEditor,
  getExtraArgValueForKey,
  mergeExtraArgsFromEditor,
  setExtraArgValueForKey,
} from "@/lib/recipes/recipe-utils";
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

  const handleCommandReset = () => {
    setEditedCommand(null);
    const nextExtraArgs = { ...(recipe.extra_args ?? {}) };
    delete nextExtraArgs["launch_command"];
    delete nextExtraArgs["custom_command"];
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
      className="relative flex shrink-0 flex-col border-l border-(--ui-border) bg-(--ui-bg)"
      style={{ width: "720px", minWidth: "min(420px, 40%)", maxWidth: "min(820px, 65%)" }}
    >
      {/* Header — matches chat sidepanel ComputerHeader (h-9, text-[11px]) */}
      <div className="relative flex h-9 shrink-0 items-center gap-2 border-b border-(--ui-border) px-2 text-[11px]">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate font-medium text-(--ui-fg)/85">
            {recipe.id ? "Edit recipe" : "New recipe"}
          </span>
          <StatusPill tone="info" variant="badge" className="shrink-0">
            {formatBackendLabel(recipe.backend)}
          </StatusPill>
        </div>
        <Button
          variant="icon"
          size="sm"
          onClick={onClose}
          aria-label="Close recipe drawer"
          title="Close"
        >
          <X className="h-3 w-3" />
        </Button>
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
          generatedCommand={generatedCommand}
          onCommandChange={handleCommandChange}
          onResetCommand={handleCommandReset}
        />
      </div>

      {/* Footer */}
      <div className="flex h-10 shrink-0 items-center justify-between gap-3 border-t border-(--ui-border) bg-(--ui-bg) px-2 text-[11px]">
        <div className="min-w-0 truncate text-(--ui-muted)/75">
          {recipe.id ? `Editing ${recipe.name}` : "Creating new recipe"}
          {extraArgsError && <span className="ml-3 text-(--ui-danger)">Extra args has errors</span>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={onSave}
            disabled={
              saving ||
              !!extraArgsError ||
              !(recipe.name ?? "").trim() ||
              !(recipe.model_path ?? "").trim()
            }
            icon={
              saving ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />
            }
          >
            {saving ? "Saving..." : "Save recipe"}
          </Button>
        </div>
      </div>
    </aside>
  );
}

const getRecipeModalSnapshot = (): number => 0;
