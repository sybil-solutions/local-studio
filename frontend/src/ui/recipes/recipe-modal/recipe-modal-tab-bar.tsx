"use client";

import { Tabs } from "@/ui";
import type { RecipeModalTabId } from "./tabs/tab-id";

const tabDefinitions: Array<{ id: RecipeModalTabId; label: string }> = [
  { id: "general", label: "General" },
  { id: "model", label: "Model" },
  { id: "resources", label: "Resources" },
  { id: "performance", label: "Performance" },
  { id: "features", label: "Features" },
  { id: "environment", label: "Environment" },
  { id: "command", label: "Command" },
];

export function RecipeModalTabBar({
  activeTab,
  onSelectTab,
}: {
  activeTab: RecipeModalTabId;
  onSelectTab: (tab: RecipeModalTabId) => void;
}) {
  return (
    <div className="relative flex min-h-9 shrink-0 items-center gap-1 border-b border-(--ui-border) px-1.5 py-1 text-[11px]">
      <Tabs
        variant="pill"
        items={tabDefinitions}
        activeTab={activeTab}
        onSelectTab={onSelectTab}
        className="min-w-0 flex-1 text-[11px] [&_button]:h-7 [&_button]:rounded-md [&_button]:px-2 [&_button]:py-0 [&_button]:text-[11px]"
      />
    </div>
  );
}
