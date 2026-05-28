"use client";

import { Code, Plus, Terminal, Variable } from "lucide-react";
import { Button, Card, FormSection, Input, Textarea } from "@/ui";
import type { RecipeEditor } from "@/lib/types";

export function RecipeModalTabEnvironment({
  recipe,
  onChange,
  isLlamacpp,
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
  isLlamacpp: boolean;
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
  return (
    <div className="space-y-5">
      {!isLlamacpp && (
        <FormSection icon={<Terminal className="h-4 w-4" />} title="Runtime Configuration">
          <Input
            label="Python Path"
            type="text"
            value={recipe.python_path || ""}
            onChange={(e) => onChange({ ...recipe, python_path: e.target.value || undefined })}
            placeholder="/usr/bin/python or venv/bin/python"
          />
        </FormSection>
      )}
      {isLlamacpp && (
        <p className="text-xs text-(--dim)">
          llama.cpp uses the configured server binary. Set{" "}
          <span className="font-mono">VLLM_STUDIO_LLAMA_BIN</span> if you need a custom path.
        </p>
      )}

      {/* Environment Variables */}
      <FormSection
        icon={<Variable className="h-4 w-4" />}
        title="Environment Variables"
        className="space-y-3"
      >
        <div className="-mt-12 flex justify-end">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onAddEnvVar}
            icon={<Plus className="h-3 w-3" />}
          >
            Add
          </Button>
        </div>

        <div className="space-y-2">
          {envVarEntries.map((entry, index) => (
            <div key={`${entry.key}-${index}`} className="grid grid-cols-[1fr,1fr,auto] gap-2">
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
              <Button variant="secondary" type="button" onClick={() => onRemoveEnvVar(index)}>
                Remove
              </Button>
            </div>
          ))}
        </div>
      </FormSection>

      {/* Extra Args */}
      <FormSection icon={<Code className="h-4 w-4" />} title="Extra CLI Arguments">
        <Card padding="sm" className="overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 bg-(--surface) border-b border-(--border)">
            <span className="text-xs text-(--dim)">JSON Editor</span>
            {extraArgsError && <span className="text-xs text-(--err)">Invalid JSON</span>}
          </div>
          <Textarea
            value={extraArgsText}
            onChange={(e) => onExtraArgsChange(e.target.value)}
            rows={10}
            spellCheck={false}
            className="border-0 bg-transparent px-3 py-2 font-mono text-xs"
            placeholder='{\"custom-flag\": true}'
          />
        </Card>
        <p className="text-xs text-(--dim)">
          Extra arguments are passed directly to the CLI. These override form fields.
        </p>
      </FormSection>

      {isLlamacpp && (
        <details className="bg-(--bg) border border-(--border) rounded-md overflow-hidden">
          <summary className="cursor-pointer px-3 py-2 text-xs text-(--dim) bg-(--surface) border-b border-(--border)">
            llama.cpp CLI Reference
          </summary>
          <div className="px-3 py-2">
            {llamaConfigLoading && (
              <div className="text-xs text-(--dim)">Loading llama.cpp config…</div>
            )}
            {!llamaConfigLoading && llamaConfigHelp?.error && (
              <div className="text-xs text-(--err)">{llamaConfigHelp.error}</div>
            )}
            {!llamaConfigLoading && !llamaConfigHelp?.error && (
              <pre className="text-xs text-(--dim) whitespace-pre-wrap">
                {llamaConfigHelp?.config ?? "No config data returned."}
              </pre>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
