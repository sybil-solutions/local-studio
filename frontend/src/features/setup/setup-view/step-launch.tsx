"use client";

import { Loader2, Rocket } from "@/ui/icon-registry";
import { Alert, Button, Card, FactGrid } from "@/ui";

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
          Local Studio will create a starter recipe for{" "}
          <span className="text-(--fg)">{selectedModel}</span>, keep the safe local defaults, and
          launch it immediately.
        </p>
        <FactGrid
          variant="panel"
          items={[
            { label: "Backend", value: "vLLM" },
            { label: "dtype", value: "auto" },
            { label: "KV cache dtype", value: "auto" },
            {
              label: "Review",
              value: "Advanced parser and tooling changes can be reviewed in Recipes after launch.",
              span: "full",
            },
          ]}
        />
        {createdRecipeId && (
          <div className="text-xs text-(--dim)">
            Starter recipe id: <span className="text-(--fg)">{createdRecipeId}</span>
          </div>
        )}
        {launchError && <Alert variant="error">{launchError}</Alert>}
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
