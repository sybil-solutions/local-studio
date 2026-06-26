"use client";

import { Code, Plus, Terminal, Trash2, Variable } from "@/ui/icon-registry";
import { Button, Card, FormSection, Input, Textarea } from "@/ui";
import type { RecipeEditor } from "@/features/recipes/recipe-editor";
import type { EngineCapabilities } from "@/features/recipes/engine-capabilities";

export function RecipeModalTabEnvironment({
  recipe,
  onChange,
  capabilities,
  envVarEntries,
  onAddEnvVar,
  onChangeEnvVar,
  onRemoveEnvVar,
  extraArgsText,
  extraArgsError,
  onExtraArgsChange,
  llamaConfigLoading,
  llamaConfigHelp,
}: {
  recipe: RecipeEditor;
  onChange: (next: RecipeEditor) => void;
  capabilities: EngineCapabilities;
  envVarEntries: Array<{ key: string; value: string }>;
  onAddEnvVar: () => void;
  onChangeEnvVar: (index: number, field: "key" | "value", value: string) => void;
  onRemoveEnvVar: (index: number) => void;
  extraArgsText: string;
  extraArgsError: string | null;
  onExtraArgsChange: (value: string) => void;
  llamaConfigLoading: boolean;
  llamaConfigHelp: { config: string | null; error?: string | null } | null;
}) {
  const isLlamacpp = capabilities.backend === "llamacpp";

  return (
    <div className="space-y-6">
      {capabilities.pythonPath ? (
        <FormSection icon={<Terminal className="h-4 w-4" />} title="Runtime">
          <Input
            label="Python Path"
            type="text"
            value={recipe.python_path || ""}
            onChange={(e) => onChange({ ...recipe, python_path: e.target.value || undefined })}
            placeholder="/usr/bin/python or venv/bin/python"
          />
        </FormSection>
      ) : null}

      {isLlamacpp ? (
        <p className="text-xs text-(--ui-muted)">
          llama.cpp uses the configured server binary. Set{" "}
          <span className="font-mono">LOCAL_STUDIO_LLAMA_BIN</span> if you need a custom path.
        </p>
      ) : null}

      <FormSection icon={<Variable className="h-4 w-4" />} title="Environment Variables">
        <div className="space-y-2">
          {envVarEntries.map((entry, index) => (
            <div key={`${entry.key}-${index}`} className="grid grid-cols-[1fr_1fr_auto] gap-2">
              <Input
                type="text"
                value={entry.key}
                onChange={(e) => onChangeEnvVar(index, "key", e.target.value)}
                placeholder="KEY"
                className="font-mono"
              />
              <Input
                type="text"
                value={entry.value}
                onChange={(e) => onChangeEnvVar(index, "value", e.target.value)}
                placeholder="value"
              />
              <Button
                variant="icon"
                type="button"
                onClick={() => onRemoveEnvVar(index)}
                aria-label="Remove variable"
                title="Remove variable"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onAddEnvVar}
          icon={<Plus className="h-3 w-3" />}
        >
          Add variable
        </Button>
      </FormSection>

      <FormSection icon={<Code className="h-4 w-4" />} title="Extra CLI Arguments">
        <Card padding="sm" className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-(--ui-border) bg-(--ui-surface) px-3 py-2">
            <span className="text-xs text-(--ui-muted)">JSON editor</span>
            {extraArgsError ? (
              <span className="text-xs text-(--ui-danger)">Invalid JSON</span>
            ) : null}
          </div>
          <Textarea
            value={extraArgsText}
            onChange={(e) => onExtraArgsChange(e.target.value)}
            rows={8}
            spellCheck={false}
            className="border-0 bg-transparent px-3 py-2 font-mono text-xs"
            placeholder={'{"custom-flag": true}'}
          />
        </Card>
        <p className="text-xs text-(--ui-muted)">
          Passed directly to the {capabilities.backend} CLI. These override form fields.
        </p>
      </FormSection>

      {isLlamacpp ? (
        <details className="overflow-hidden rounded-md border border-(--ui-border) bg-(--ui-bg)">
          <summary className="cursor-pointer border-b border-(--ui-border) bg-(--ui-surface) px-3 py-2 text-xs text-(--ui-muted)">
            llama.cpp CLI Reference
          </summary>
          <div className="px-3 py-2">
            {llamaConfigLoading ? (
              <div className="text-xs text-(--ui-muted)">Loading llama.cpp config…</div>
            ) : null}
            {!llamaConfigLoading && llamaConfigHelp?.error ? (
              <div className="text-xs text-(--ui-danger)">{llamaConfigHelp.error}</div>
            ) : null}
            {!llamaConfigLoading && !llamaConfigHelp?.error ? (
              <pre className="whitespace-pre-wrap text-xs text-(--ui-muted)">
                {llamaConfigHelp?.config ?? "No config data returned."}
              </pre>
            ) : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}
