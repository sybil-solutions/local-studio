"use client";

import { useCallback, useMemo, useState } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import api from "@/lib/api/client";
import type { Backend, RecipeWithStatus } from "@/lib/types";
import type { RecipeEditor } from "@/features/recipes/recipe-editor";
import { ENGINE_LABEL, getEngineCapabilities } from "@/features/recipes/engine-capabilities";
import { generateCommand } from "@/features/recipes/recipe-command";
import {
  filterExtraArgsForEditor,
  mergeExtraArgsFromEditor,
} from "@/features/recipes/editor-extra-args";
import { getExtraArgValueForKey, setExtraArgValueForKey } from "@/features/recipes/extra-args";
import type { RecipeModalTabId } from "./tabs/tab-id";
import {
  envVarEntriesFromRecipe,
  formatEditableExtraArgs,
  formatRecipeSource,
  getCommandOverride,
  parseRecipeSource,
} from "./recipe-modal-source";

function useRuntimeInstallation(backend: Backend) {
  const [installing, setInstalling] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const install = useCallback(
    async (targetId?: string) => {
      setInstalling(true);
      setMessage(null);
      try {
        const result = await api.createRuntimeJob({ backend, type: "install", targetId });
        setMessage(result.job.message || `${ENGINE_LABEL[backend]} installation started`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Runtime installation failed");
      } finally {
        setInstalling(false);
      }
    },
    [backend],
  );
  return { installing, message, install };
}

export function useRecipeModalModel({
  recipe,
  onChange,
  recipes,
}: {
  recipe: RecipeEditor;
  onChange: (recipe: RecipeEditor) => void;
  recipes: RecipeWithStatus[];
}) {
  const [activeTab, setActiveTab] = useState<RecipeModalTabId>("general");
  const [editedCommand, setEditedCommand] = useState<string | null>(null);
  const [recipeSourceText, setRecipeSourceText] = useState(() => formatRecipeSource(recipe));
  const [recipeSourceError, setRecipeSourceError] = useState<string | null>(null);
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
  const runtimeInstallation = useRuntimeInstallation(backend);
  const capabilities = useMemo(() => getEngineCapabilities(backend), [backend]);
  const isLlamacpp = backend === "llamacpp";
  const llamaConfigLoading = isLlamacpp && !llamaConfigHelp;
  const safeActiveTab = capabilities.tabs.includes(activeTab) ? activeTab : "general";

  useMountSubscription(() => {
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

  const applyRecipeChange = useCallback(
    (next: RecipeEditor, options: { syncSource?: boolean; syncAuxiliary?: boolean } = {}) => {
      onChange(next);
      if (options.syncSource !== false) {
        setRecipeSourceText(formatRecipeSource(next));
        setRecipeSourceError(null);
      }
      if (options.syncAuxiliary) {
        setExtraArgsText(formatEditableExtraArgs(next));
        setExtraArgsError(null);
        setEnvVarEntries(envVarEntriesFromRecipe(next));
      }
    },
    [onChange],
  );

  const getExtraArgValueForKeyLocal = (key: string): unknown => {
    return getExtraArgValueForKey(recipe.extra_args ?? {}, key);
  };

  const setExtraArgValueForKeyLocal = (key: string, value: unknown) => {
    const nextExtraArgs = setExtraArgValueForKey(recipe.extra_args ?? {}, key, value);
    applyRecipeChange({ ...recipe, extra_args: nextExtraArgs });
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

  const generatedCommand = useMemo(
    () => generateCommand(recipe, { includeCommandOverride: false }),
    [recipe],
  );
  const savedCommandOverride = getCommandOverride(recipe);
  const commandText = editedCommand ?? savedCommandOverride ?? generatedCommand;
  const hasCommandOverride = editedCommand !== null || savedCommandOverride !== null;

  const handleCommandChange = (value: string) => {
    const nextExtraArgs = { ...(recipe.extra_args ?? {}) };
    const isOverride = Boolean(value.trim()) && value !== generatedCommand;
    if (isOverride) {
      nextExtraArgs["launch_command"] = value;
    } else {
      delete nextExtraArgs["launch_command"];
      delete nextExtraArgs["custom_command"];
    }
    // Clear editedCommand when the typed value matches the generated command, so
    // hasCommandOverride doesn't stay true and show a false "override" badge.
    setEditedCommand(isOverride ? value : null);
    applyRecipeChange({ ...recipe, extra_args: nextExtraArgs });
  };

  const handleCommandReset = () => {
    setEditedCommand(null);
    const nextExtraArgs = { ...(recipe.extra_args ?? {}) };
    delete nextExtraArgs["launch_command"];
    delete nextExtraArgs["custom_command"];
    applyRecipeChange({ ...recipe, extra_args: nextExtraArgs });
  };

  const handleRecipeSourceChange = (value: string) => {
    setRecipeSourceText(value);
    const result = parseRecipeSource(value);
    if (!("recipe" in result)) {
      setRecipeSourceError(result.error);
      return;
    }
    setRecipeSourceError(null);
    setEditedCommand(null);
    applyRecipeChange(result.recipe, { syncSource: false, syncAuxiliary: true });
  };

  const handleRecipeSourceFormat = () => {
    const formatted = formatRecipeSource(recipe);
    setRecipeSourceText(formatted);
    setRecipeSourceError(null);
  };

  const handleExtraArgsChange = (value: string) => {
    setExtraArgsText(value);
    if (!value.trim()) {
      const merged = mergeExtraArgsFromEditor(recipe.extra_args ?? {}, {});
      applyRecipeChange({ ...recipe, extra_args: merged });
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
      applyRecipeChange({ ...recipe, extra_args: merged });
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
    applyRecipeChange({ ...recipe, env_vars: Object.keys(envVars).length ? envVars : undefined });
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

  return {
    backend,
    capabilities,
    safeActiveTab,
    setActiveTab,
    runtimeInstallation,
    applyRecipeChange,
    getExtraArgValueForKeyLocal,
    setExtraArgValueForKeyLocal,
    modelServedNames,
    generatedCommand,
    commandText,
    hasCommandOverride,
    handleCommandChange,
    handleCommandReset,
    recipeSourceText,
    recipeSourceError,
    handleRecipeSourceChange,
    handleRecipeSourceFormat,
    extraArgsText,
    extraArgsError,
    handleExtraArgsChange,
    envVarEntries,
    handleEnvVarChange,
    handleAddEnvVar,
    handleRemoveEnvVar,
    llamaConfigLoading,
    llamaConfigHelp,
  };
}
