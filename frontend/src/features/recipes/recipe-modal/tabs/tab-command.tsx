"use client";

import { Code, RotateCcw, Terminal } from "@/ui/icon-registry";
import { Button, FormSection } from "@/ui";

export function RecipeModalTabCommand({
  recipeSourceText,
  recipeSourceError,
  onRecipeSourceChange,
  onFormatRecipeSource,
  commandText,
  generatedCommand,
  hasCommandOverride,
  onCommandChange,
  onResetCommand,
}: {
  recipeSourceText: string;
  recipeSourceError: string | null;
  onRecipeSourceChange: (value: string) => void;
  onFormatRecipeSource: () => void;
  commandText: string;
  generatedCommand: string;
  hasCommandOverride: boolean;
  onCommandChange: (value: string) => void;
  onResetCommand: () => void;
}) {
  return (
    <div className="flex h-full min-h-[720px] flex-col gap-5">
      <section className="flex min-h-[410px] flex-1 flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <FormSection icon={<Code className="h-4 w-4" />} title="Recipe JSON" />
          <div className="flex shrink-0 items-center gap-2">
            {recipeSourceError ? (
              <span className="rounded-md bg-(--ui-danger)/15 px-2 py-1 text-[length:var(--fs-sm)] font-medium text-(--ui-danger)">
                invalid
              </span>
            ) : (
              <span className="rounded-md bg-(--ui-success)/15 px-2 py-1 text-[length:var(--fs-sm)] font-medium text-(--ui-success)">
                synced
              </span>
            )}
            <Button variant="ghost" size="sm" onClick={onFormatRecipeSource}>
              Format
            </Button>
          </div>
        </div>

        <textarea
          value={recipeSourceText}
          onChange={(e) => onRecipeSourceChange(e.target.value)}
          spellCheck={false}
          className="min-h-[360px] flex-1 resize-none rounded-[10px] border border-(--ui-border) bg-(--color-surface) px-4 py-3 font-mono text-[length:var(--fs-md)] leading-5 text-(--ui-fg) outline-none selection:bg-(--ui-info)/25 placeholder:text-(--ui-muted)/50 focus:border-(--ui-border) focus:ring-1 focus:ring-(--link)/45"
          placeholder='{"id":"my-model","name":"My model","model_path":"/models/my-model"}'
        />
        {recipeSourceError ? (
          <p className="text-xs text-(--ui-danger)">{recipeSourceError}</p>
        ) : null}
      </section>

      <section className="flex min-h-[260px] flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <FormSection icon={<Terminal className="h-4 w-4" />} title="Launch command" />
          <div className="flex shrink-0 items-center gap-2">
            <span
              className={`rounded-md px-2 py-1 text-[length:var(--fs-sm)] font-medium ${
                hasCommandOverride
                  ? "bg-(--ui-warning)/15 text-(--ui-warning)"
                  : "bg-(--ui-info)/15 text-(--ui-info)"
              }`}
            >
              {hasCommandOverride ? "override" : "generated"}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={onResetCommand}
              disabled={!hasCommandOverride}
              icon={<RotateCcw className="h-3 w-3" />}
            >
              Reset
            </Button>
          </div>
        </div>

        <textarea
          value={commandText}
          onChange={(e) => onCommandChange(e.target.value)}
          spellCheck={false}
          className="min-h-[220px] flex-1 resize-none rounded-[10px] border border-(--ui-border) bg-(--color-surface) px-4 py-3 font-mono text-[length:var(--fs-md)] leading-6 text-(--ui-fg) outline-none selection:bg-(--ui-info)/25 placeholder:text-(--ui-muted)/50 focus:border-(--ui-border) focus:ring-1 focus:ring-(--link)/45"
          placeholder={generatedCommand || "Command will appear here..."}
        />
      </section>
    </div>
  );
}
