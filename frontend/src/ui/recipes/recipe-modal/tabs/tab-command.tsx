"use client";

import { RotateCcw } from "lucide-react";
import { Button, FormSection } from "@/ui";

export function RecipeModalTabCommand({
  commandText,
  generatedCommand,
  onCommandChange,
  onResetCommand,
}: {
  commandText: string;
  generatedCommand: string;
  onCommandChange: (value: string) => void;
  onResetCommand: () => void;
}) {
  const hasOverride = commandText !== generatedCommand;

  return (
    <div className="flex h-full min-h-[640px] flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <FormSection title="Launch command" />
        <Button
          variant="ghost"
          size="sm"
          onClick={onResetCommand}
          disabled={!hasOverride}
          icon={<RotateCcw className="h-3 w-3" />}
        >
          Reset
        </Button>
      </div>

      <textarea
        value={commandText}
        onChange={(e) => onCommandChange(e.target.value)}
        spellCheck={false}
        className="min-h-[580px] flex-1 resize-none rounded-md border border-(--ui-border) bg-[#050505] px-4 py-3 font-mono text-[12px] leading-6 text-(--ui-fg) outline-none selection:bg-(--ui-info)/25 placeholder:text-(--ui-muted)/50 focus:border-(--ui-border) focus:ring-1 focus:ring-(--ui-info)/45"
        placeholder="Command will appear here..."
      />
    </div>
  );
}
