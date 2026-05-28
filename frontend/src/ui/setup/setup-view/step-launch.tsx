"use client";

import { AlertTriangle, Loader2, Rocket } from "lucide-react";
import { Button, Card } from "@/ui";

export function StepLaunch({
  selectedModel,
  createdRecipeId,
  configuringRecipe,
  launchError,
  configureAndLaunch,
}: {
  selectedModel: string;
  createdRecipeId: string | null;
  configuringRecipe: boolean;
  launchError: string | null;
  configureAndLaunch: () => void;
}) {
  return (
    <div className="space-y-6">
      <Card padding="lg" className="space-y-4">
        <div className="flex items-center gap-3">
          <Rocket className="h-5 w-5 text-(--hl1)" />
          <h2 className="text-lg font-medium">Configure and Launch</h2>
        </div>
        <p className="text-sm text-(--dim)">
          vLLM Studio will create a starter recipe for{" "}
          <span className="text-(--fg)">{selectedModel}</span>, keep the safe local defaults, and
          launch it immediately.
        </p>
        <div className="rounded-lg border border-(--surface) bg-(--surface)/40 p-4 text-sm text-(--dim)">
          <div>Backend: vLLM</div>
          <div>dtype: auto</div>
          <div>KV cache dtype: auto</div>
          <div>Advanced parser and tooling changes can be reviewed in Recipes after launch.</div>
        </div>
        {createdRecipeId && (
          <div className="text-xs text-(--dim)">
            Starter recipe id: <span className="text-(--fg)">{createdRecipeId}</span>
          </div>
        )}
        {launchError && (
          <div className="flex items-start gap-2 rounded-lg border border-(--err)/30 bg-(--err)/10 p-3 text-sm text-(--err)">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{launchError}</span>
          </div>
        )}
        <Button
          onClick={configureAndLaunch}
          disabled={configuringRecipe}
          icon={
            configuringRecipe ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Rocket className="h-4 w-4" />
            )
          }
        >
          {configuringRecipe ? "Launching..." : "Configure & Launch"}
        </Button>
      </Card>
    </div>
  );
}
