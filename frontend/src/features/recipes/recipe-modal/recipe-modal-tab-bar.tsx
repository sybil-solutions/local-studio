"use client";

import { Tabs } from "@/ui";
import type { RecipeModalTabId } from "./tabs/tab-id";

const TAB_LABELS: Record<RecipeModalTabId, string> = {
  general: "Pipeline",
  model: "Model",
  resources: "Resources",
  performance: "Performance",
  features: "Features",
  environment: "Environment",
  command: "Command",
};

export function RecipeModalTabBar({
  tabs,
  activeTab,
  onSelectTab,
}: {
  tabs: RecipeModalTabId[];
  activeTab: RecipeModalTabId;
  onSelectTab: (tab: RecipeModalTabId) => void;
}) {
  const items = tabs.map((id) => ({ id, label: TAB_LABELS[id] }));
  return (
    <div className="relative flex min-h-9 shrink-0 items-center gap-1 border-b border-(--ui-border) px-1.5 py-1 text-[length:var(--fs-sm)]">
      <Tabs
        variant="pill"
        items={items}
        activeTab={activeTab}
        onSelectTab={onSelectTab}
        className="min-w-0 flex-1 text-[length:var(--fs-sm)] [&_button]:h-7 [&_button]:rounded-md [&_button]:px-2 [&_button]:py-0 [&_button]:text-[length:var(--fs-sm)]"
      />
    </div>
  );
}
