"use client";

import { ChevronRight, Loader2, Rocket } from "lucide-react";
import { Button, Card, Input } from "@/ui";
import type { StudioSettings } from "@/lib/types";

export function StepWelcome({
  modelsDir,
  setModelsDir,
  settings,
  saveSettings,
  savingSettings,
}: {
  modelsDir: string;
  setModelsDir: (value: string) => void;
  settings: StudioSettings | null;
  saveSettings: () => void;
  savingSettings: boolean;
}) {
  return (
    <Card padding="lg" className="space-y-5">
      <div className="flex items-center gap-3">
        <Rocket className="h-5 w-5 text-(--hl1)" />
        <h2 className="text-lg font-medium">Welcome to vLLM Studio</h2>
      </div>
      <p className="text-sm text-(--dim)">
        This wizard configures local paths, checks your hardware, and downloads a starter model so
        you can chat right away.
      </p>
      <div>
        <Input
          label="Models directory"
          value={modelsDir}
          onChange={(event) => setModelsDir(event.target.value)}
        />
        {settings?.config_path && (
          <div className="text-xs text-(--dim) mt-2">Saved to {settings.config_path}</div>
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
