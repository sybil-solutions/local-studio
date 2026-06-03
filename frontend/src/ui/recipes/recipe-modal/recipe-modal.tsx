"use client";

import { useCallback, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { Cpu, HardDrive, Network, RefreshCw, Save } from "lucide-react";
import { Button, StatusPill } from "@/ui";
import { Drawer, DrawerBody, DrawerFooter, DrawerHeader } from "@/ui/drawer";
import api from "@/lib/api";
import type { Backend, ModelInfo, Recipe, RecipeEditor, RecipeWithStatus } from "@/lib/types";
import { formatBackendLabel } from "@/lib/recipes/recipe-labels";
import { generateCommand } from "@/lib/recipes/recipe-command";
import {
  filterExtraArgsForEditor,
  getExtraArgValueForKey,
  mergeExtraArgsFromEditor,
  normalizeRecipeForEditor,
  prepareRecipeForSave,
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
    setEditedCommand(value);
    const nextExtraArgs = { ...(recipe.extra_args ?? {}) };
    if (value.trim() && value !== generatedCommand) {
      nextExtraArgs["launch_command"] = value;
    } else {
      delete nextExtraArgs["launch_command"];
      delete nextExtraArgs["custom_command"];
    }
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

  return (
    <Drawer width={860}>
      <DrawerHeader
        title={recipe.id ? recipe.name || "Edit recipe" : "New recipe"}
        badge={
          <StatusPill tone="info" variant="badge" className="shrink-0">
            {formatBackendLabel(recipe.backend)}
          </StatusPill>
        }
        onClose={onClose}
      />

      <RecipeModalTabBar activeTab={activeTab} onSelectTab={setActiveTab} />

      <DrawerBody>
        <div className="space-y-4">
          <RecipeModalSummary
            recipe={recipe}
            backend={backend}
            commandOverridden={hasCommandOverride}
          />
          <RecipeModalTabContent
            activeTab={activeTab}
            recipe={recipe}
            onChange={applyRecipeChange}
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
            recipeSourceText={recipeSourceText}
            recipeSourceError={recipeSourceError}
            onRecipeSourceChange={handleRecipeSourceChange}
            onFormatRecipeSource={handleRecipeSourceFormat}
            commandText={commandText}
            generatedCommand={generatedCommand}
            hasCommandOverride={hasCommandOverride}
            onCommandChange={handleCommandChange}
            onResetCommand={handleCommandReset}
          />
        </div>
      </DrawerBody>

      <DrawerFooter
        status={
          <>
            {recipe.id ? `Editing ${recipe.name}` : "Creating new recipe"}
            {extraArgsError && (
              <span className="ml-3 text-(--ui-danger)">Extra args has errors</span>
            )}
            {recipeSourceError && (
              <span className="ml-3 text-(--ui-danger)">Recipe JSON has errors</span>
            )}
          </>
        }
      >
        <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={onSave}
          disabled={
            saving ||
            !!extraArgsError ||
            !!recipeSourceError ||
            !(recipe.name ?? "").trim() ||
            !(recipe.model_path ?? "").trim()
          }
          icon={
            saving ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />
          }
        >
          {saving ? "Saving..." : "Save recipe"}
        </Button>
      </DrawerFooter>
    </Drawer>
  );
}

function RecipeModalSummary({
  recipe,
  backend,
  commandOverridden,
}: {
  recipe: RecipeEditor;
  backend: Backend;
  commandOverridden: boolean;
}) {
  return (
    <div className="grid gap-2 md:grid-cols-3">
      <SummaryCell
        icon={<Cpu className="h-3.5 w-3.5" />}
        label="Backend"
        value={formatBackendLabel(backend)}
      />
      <SummaryCell
        icon={<HardDrive className="h-3.5 w-3.5" />}
        label="Model"
        value={recipe.model_path || "Select a model"}
      />
      <SummaryCell
        icon={<Network className="h-3.5 w-3.5" />}
        label="API name"
        value={recipe.served_model_name || recipe.name || "Generated"}
        badge={commandOverridden ? "command override" : undefined}
      />
    </div>
  );
}

function SummaryCell({
  icon,
  label,
  value,
  badge,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  badge?: string;
}) {
  return (
    <div className="min-w-0 rounded-md border border-(--ui-border) bg-(--ui-surface) px-3 py-2">
      <div className="mb-1 flex items-center gap-1.5 text-[length:var(--fs-xs)] uppercase tracking-[0.12em] text-(--ui-muted)">
        {icon}
        {label}
      </div>
      <div className="truncate text-[length:var(--fs-md)] font-medium text-(--ui-fg)" title={value}>
        {value}
      </div>
      {badge ? (
        <div className="mt-1 text-[length:var(--fs-xs)] text-(--ui-warning)">{badge}</div>
      ) : null}
    </div>
  );
}

const getRecipeModalSnapshot = (): number => 0;

const BACKENDS = new Set<Backend>(["vllm", "sglang", "llamacpp", "mlx"]);

function getCommandOverride(recipe: RecipeEditor): string | null {
  const launchCommand = recipe.extra_args?.["launch_command"];
  if (typeof launchCommand === "string" && launchCommand.trim()) return launchCommand;
  const customCommand = recipe.extra_args?.["custom_command"];
  if (typeof customCommand === "string" && customCommand.trim()) return customCommand;
  return null;
}

function formatRecipeSource(recipe: RecipeEditor): string {
  return JSON.stringify(prepareRecipeForSave(recipe), null, 2);
}

function formatEditableExtraArgs(recipe: RecipeEditor): string {
  return JSON.stringify(filterExtraArgsForEditor(recipe.extra_args ?? {}), null, 2);
}

function envVarEntriesFromRecipe(recipe: RecipeEditor): Array<{ key: string; value: string }> {
  const entries = Object.entries(recipe.env_vars ?? {}).map(([key, value]) => ({
    key,
    value: String(value),
  }));
  return entries.length ? entries : [{ key: "", value: "" }];
}

function parseRecipeSource(
  value: string,
): { recipe: RecipeEditor; error: null } | { error: string } {
  if (!value.trim()) {
    return { error: "Recipe JSON is required." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { error: "Recipe source must be valid JSON." };
  }

  if (!isPlainObject(parsed)) {
    return { error: "Recipe source must be a JSON object." };
  }

  const record = parsed as Record<string, unknown>;
  const requiredStringFields = ["id", "name", "model_path"].filter(
    (field) => typeof record[field] !== "string",
  );
  if (requiredStringFields.length) {
    return { error: `Recipe needs string field(s): ${requiredStringFields.join(", ")}.` };
  }

  if (record.backend !== undefined && !BACKENDS.has(record.backend as Backend)) {
    return { error: "Recipe backend is not supported." };
  }

  if (
    record.extra_args !== undefined &&
    record.extra_args !== null &&
    !isPlainObject(record.extra_args)
  ) {
    return { error: "extra_args must be a JSON object." };
  }

  if (
    record.env_vars !== undefined &&
    record.env_vars !== null &&
    !isPlainObject(record.env_vars)
  ) {
    return { error: "env_vars must be a JSON object or null." };
  }

  return { recipe: normalizeRecipeForEditor(record as unknown as Recipe), error: null };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
