"use client";

import { ChevronRight, Loader2, Rocket } from "lucide-react";
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
    <div className="bg-(--bg) border border-(--surface) rounded-lg p-6 space-y-5">
      <div className="flex items-center gap-3">
        <Rocket className="h-5 w-5 text-(--hl1)" />
        <h2 className="text-lg font-medium">Welcome to vLLM Studio</h2>
      </div>
      <p className="text-sm text-(--dim)">
        This wizard configures local paths, checks your hardware, and downloads a starter model so
        you can chat right away.
      </p>
      <div>
        <label className="block text-xs text-(--dim) mb-2">Models directory</label>
        <input
          value={modelsDir}
          onChange={(event) => setModelsDir(event.target.value)}
          className="w-full bg-(--bg) border border-(--surface) rounded-lg px-3 py-2 text-sm"
        />
        {settings?.config_path && (
          <div className="text-xs text-(--dim) mt-2">Saved to {settings.config_path}</div>
        )}
      </div>
      <div className="flex items-center justify-end gap-3">
        <button
          onClick={saveSettings}
          disabled={savingSettings}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-(--hl1) text-white text-sm font-medium hover:opacity-90 disabled:opacity-60"
        >
          {savingSettings ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          Continue
        </button>
      </div>
    </div>
  );
}
