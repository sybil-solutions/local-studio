"use client";

import { Cpu, Info, Network, Rocket, Server } from "@/ui/icon-registry";
import { Alert, Button, FormField, FormSection, Input, Select, StatusPill } from "@/ui";
import { ModelLogo } from "@/ui/model-logo";
import { modelIdFromPath } from "@/lib/huggingface";
import type { ModelInfo, RuntimeTarget } from "@/lib/types";
import type { RecipeEditor } from "@/features/recipes/recipe-editor";
import {
  preferredRuntimeForBackend,
  runtimeId,
  runtimeOptionFor,
  runtimeOptionsFor,
} from "@/features/recipes/serve-runtime-options";

const PIPELINE_STEPS = ["Get", "Runtime", "Configure", "Serve"];

function ServePipelineRail({ recipe }: { recipe: RecipeEditor }) {
  const completed = recipe.model_path ? (recipe.runtime?.ref ? 2 : 1) : 0;
  return (
    <ol className="grid grid-cols-4 overflow-hidden rounded-md border border-(--ui-border) bg-(--ui-bg)">
      {PIPELINE_STEPS.map((label, index) => {
        const done = index < completed;
        const active = index === completed;
        return (
          <li
            key={label}
            className={`flex min-w-0 items-center gap-2 border-r border-(--ui-border) px-3 py-2.5 last:border-r-0 ${
              active ? "bg-(--ui-info)/10 text-(--ui-fg)" : "text-(--ui-muted)"
            }`}
          >
            <span
              className={`grid h-5 w-5 shrink-0 place-items-center rounded-full font-mono text-[length:var(--fs-2xs)] ${
                done
                  ? "bg-(--ui-success) text-(--color-foreground-inverse)"
                  : active
                    ? "bg-(--ui-info) text-(--color-foreground-inverse)"
                    : "border border-(--ui-border)"
              }`}
            >
              {index + 1}
            </span>
            <span className="truncate text-[length:var(--fs-xs)] font-medium uppercase tracking-[0.08em]">
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function RecipeModalTabGeneral({
  recipe,
  onChange,
  availableModels,
  modelServedNames,
  runtimeTargets,
  installingRuntime,
  runtimeInstallMessage,
  onInstallRuntime,
}: {
  recipe: RecipeEditor;
  onChange: (next: RecipeEditor) => void;
  availableModels: ModelInfo[];
  modelServedNames: Record<string, string>;
  runtimeTargets: RuntimeTarget[];
  installingRuntime: boolean;
  runtimeInstallMessage: string | null;
  onInstallRuntime: (targetId?: string) => void;
}) {
  const backend = recipe.backend ?? "vllm";
  const options = runtimeOptionsFor(backend, runtimeTargets);
  const runtime = recipe.runtime ?? preferredRuntimeForBackend(backend, runtimeTargets);
  const selected = runtimeOptionFor(runtime, options);
  const allOptions = options.some((option) => option.id === selected.id)
    ? options
    : [selected, ...options];
  const isCustomPath =
    Boolean(recipe.model_path) &&
    !availableModels.some((model) => model.path === recipe.model_path);

  return (
    <div className="space-y-6">
      <ServePipelineRail recipe={{ ...recipe, runtime }} />

      <FormSection icon={<Cpu className="h-4 w-4" />} title="Runtime">
        <FormField
          label="How this Serve runs"
          required
          description="This choice is stored on the Serve and is the runtime used at launch."
        >
          <Select
            value={selected.id}
            onChange={(event) => {
              const option = allOptions.find((entry) => entry.id === event.target.value);
              if (option) onChange({ ...recipe, runtime: option.runtime });
            }}
          >
            {allOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label} · {option.detail}
              </option>
            ))}
          </Select>
        </FormField>
        <div className="flex items-center justify-between gap-3 rounded-md border border-(--ui-separator) bg-(--ui-bg) px-3 py-2.5">
          <div className="min-w-0">
            <div className="truncate font-mono text-[length:var(--fs-sm)] text-(--ui-fg)">
              {runtime.kind} · {runtime.ref}
            </div>
            <div className="mt-0.5 text-[length:var(--fs-xs)] text-(--ui-muted)">
              {selected.version ? `version ${selected.version}` : selected.detail}
            </div>
          </div>
          <StatusPill tone={selected.installed ? "good" : "warning"} variant="badge">
            {selected.installed ? "ready" : "install required"}
          </StatusPill>
        </div>
        {selected.canInstall ? (
          <Alert variant="warning" className="py-3">
            <div className="flex items-center justify-between gap-4">
              <span>{selected.label} is not installed on this controller.</span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onInstallRuntime(selected.targetId)}
                disabled={installingRuntime}
              >
                {installingRuntime ? "Starting…" : "Install here"}
              </Button>
            </div>
          </Alert>
        ) : null}
        {runtimeInstallMessage ? <Alert variant="info">{runtimeInstallMessage}</Alert> : null}
      </FormSection>

      <FormSection icon={<Info className="h-4 w-4" />} title="Serve Identity">
        <FormField label="Name" required>
          <Input
            value={recipe.name ?? ""}
            onChange={(event) => onChange({ ...recipe, name: event.target.value })}
            placeholder="Llama 3.1 8B · fast chat"
          />
        </FormField>

        <FormField
          label="Model weights"
          required
          description={isCustomPath ? `Downloaded path: ${recipe.model_path}` : undefined}
        >
          <div className="flex items-center gap-2.5">
            <ModelLogo
              modelId={recipe.model_path ? modelIdFromPath(recipe.model_path) : "model"}
              size="md"
            />
            <Select
              value={recipe.model_path ?? ""}
              onChange={(event) => onChange({ ...recipe, model_path: event.target.value })}
              placeholder="Select downloaded weights…"
              className="flex-1"
            >
              {isCustomPath ? <option value={recipe.model_path}>{recipe.model_path}</option> : null}
              {availableModels.map((model) => {
                const servedName = modelServedNames[model.path];
                return (
                  <option key={model.path} value={model.path}>
                    {servedName ? `${servedName} (${model.name})` : model.name}
                  </option>
                );
              })}
            </Select>
          </div>
        </FormField>
      </FormSection>

      <FormSection icon={<Server className="h-4 w-4" />} title="API Endpoint">
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Host">
            <Input
              value={recipe.host ?? "0.0.0.0"}
              onChange={(event) => onChange({ ...recipe, host: event.target.value || undefined })}
              placeholder="0.0.0.0"
            />
          </FormField>
          <FormField label="Port">
            <Input
              type="number"
              value={recipe.port ?? 8000}
              onChange={(event) =>
                onChange({ ...recipe, port: Number(event.target.value) || undefined })
              }
            />
          </FormField>
        </div>

        <FormField label="Model API name" description="The name exposed through /v1/models.">
          <Input
            value={recipe.served_model_name || ""}
            onChange={(event) =>
              onChange({ ...recipe, served_model_name: event.target.value || undefined })
            }
            placeholder="deepseek-v4-flash"
            icon={<Network className="h-3.5 w-3.5" />}
          />
        </FormField>

        <div className="flex items-center gap-2 rounded-md border border-(--ui-separator) bg-(--ui-bg) px-3 py-2 text-[length:var(--fs-xs)] text-(--ui-muted)">
          <Rocket className="h-3.5 w-3.5 text-(--ui-info)" />
          Save this Serve, then launch it from the Serves tab with the same runtime and settings.
        </div>
      </FormSection>
    </div>
  );
}
