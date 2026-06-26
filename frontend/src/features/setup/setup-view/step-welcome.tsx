"use client";

import { ChevronRight, Loader2, Rocket } from "@/ui/icon-registry";
import { Button, Card, Input, StatusPill } from "@/ui";
import type { StudioDiagnostics, StudioSettings } from "@/lib/types";

export function StepWelcome({
  modelsDir,
  setModelsDir,
  settings,
  diagnostics,
  saveSettings,
  savingSettings,
}: {
  modelsDir: string;
  setModelsDir: (value: string) => void;
  settings: StudioSettings | null;
  diagnostics: StudioDiagnostics | null;
  saveSettings: () => void;
  savingSettings: boolean;
}) {
  const controllerLabel = diagnostics
    ? [
        diagnostics.platform,
        diagnostics.arch,
        diagnostics.gpus.length ? `${diagnostics.gpus.length} GPU` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "controller pending";

  return (
    <Card padding="lg" className="space-y-5">
      <div className="flex items-center gap-3">
        <Rocket className="h-5 w-5 text-(--hl1)" />
        <h2 className="text-lg font-medium">Welcome to Local Studio</h2>
      </div>
      <p className="text-sm text-(--dim)">
        This desktop wizard configures the active controller. Model files, runtime checks, and
        downloads happen on that controller, while this Mac stays the control surface.
      </p>
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-(--ui-border) bg-(--ui-hover)/30 px-3 py-2 text-sm">
        <span className="text-(--dim)">Setup target</span>
        <StatusPill tone={diagnostics ? "info" : "warning"}>{controllerLabel}</StatusPill>
      </div>
      <div>
        <Input
          label="Controller models directory"
          value={modelsDir}
          onChange={(event) => setModelsDir(event.target.value)}
          placeholder="/mnt/llm_models"
        />
        {settings?.config_path && (
          <div className="text-xs text-(--dim) mt-2">Controller config: {settings.config_path}</div>
        )}
      </div>
      <div className="flex items-center justify-end gap-3">
        <Button
          onClick={saveSettings}
          disabled={savingSettings}
          icon={
            savingSettings ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )
          }
        >
          Continue
        </Button>
      </div>
    </Card>
  );
}
