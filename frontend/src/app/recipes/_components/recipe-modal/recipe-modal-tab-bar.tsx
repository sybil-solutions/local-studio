"use client";

import type { ReactNode } from "react";
import { Code, Cpu, Layers, Sparkles, Terminal, Settings, Zap } from "lucide-react";
import type { RecipeModalTabId } from "./tabs/tab-id";

const tabDefinitions: Array<{ id: RecipeModalTabId; label: string; icon: ReactNode }> = [
  { id: "general", label: "General", icon: <Settings className="h-3 w-3 shrink-0" /> },
  { id: "model", label: "Model", icon: <Layers className="h-3 w-3 shrink-0" /> },
  { id: "resources", label: "Resources", icon: <Cpu className="h-3 w-3 shrink-0" /> },
  { id: "performance", label: "Performance", icon: <Zap className="h-3 w-3 shrink-0" /> },
  { id: "features", label: "Features", icon: <Sparkles className="h-3 w-3 shrink-0" /> },
  { id: "environment", label: "Environment", icon: <Terminal className="h-3 w-3 shrink-0" /> },
  { id: "command", label: "Command", icon: <Code className="h-3 w-3 shrink-0" /> },
];

export function RecipeModalTabBar({
  activeTab,
  onSelectTab,
}: {
  activeTab: RecipeModalTabId;
  onSelectTab: (tab: RecipeModalTabId) => void;
}) {
  return (
    <div className="relative flex h-9 shrink-0 items-center gap-1 border-b border-(--border) px-1.5 text-[11px]">
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:thin]">
        {tabDefinitions.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelectTab(tab.id)}
              className={`inline-flex h-8 min-w-0 shrink-0 items-center gap-1 rounded-md px-1.5 text-left ${
                active
                  ? "text-(--fg)/70 hover:bg-(--surface) hover:text-(--fg)/85"
                  : "text-(--dim)/75 hover:bg-(--surface) hover:text-(--fg)/75"
              }`}
              title={tab.label}
            >
              {tab.icon}
              <span className="max-w-[7rem] truncate">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
