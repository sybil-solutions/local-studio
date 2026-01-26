// CRITICAL
"use client";

import { PanelRightOpen, Settings, BarChart3, Download, Server, Layers } from "lucide-react";

interface ChatActionButtonsProps {
  activityCount: number;
  onOpenActivity: () => void;
  onOpenContext: () => void;
  onOpenSettings: () => void;
  onOpenMcpSettings: () => void;
  onOpenUsage: () => void;
  onOpenExport: () => void;
}

export function ChatActionButtons({
  activityCount,
  onOpenActivity,
  onOpenContext,
  onOpenSettings,
  onOpenMcpSettings,
  onOpenUsage,
  onOpenExport,
}: ChatActionButtonsProps) {
  return (
    <div className="absolute right-3 top-3 z-10 hidden md:flex flex-col items-center gap-2">
      <button
        onClick={onOpenActivity}
        className="relative p-1.5 bg-(--card) border border-(--border) rounded hover:bg-(--accent)"
        title="Show activity"
      >
        <PanelRightOpen className="h-4 w-4 text-[#9a9590]" />
        {activityCount > 0 && (
          <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-(--success) rounded-full text-[9px] text-white font-medium flex items-center justify-center">
            {activityCount}
          </span>
        )}
      </button>
      <button
        onClick={onOpenContext}
        className="p-1.5 bg-(--card) border border-(--border) rounded hover:bg-(--accent)"
        title="Context"
      >
        <Layers className="h-4 w-4 text-[#9a9590]" />
      </button>
      <button
        onClick={onOpenSettings}
        className="p-1.5 bg-(--card) border border-(--border) rounded hover:bg-(--accent)"
        title="Settings"
      >
        <Settings className="h-4 w-4 text-[#9a9590]" />
      </button>
      <button
        onClick={onOpenMcpSettings}
        className="p-1.5 bg-(--card) border border-(--border) rounded hover:bg-(--accent)"
        title="MCP Servers"
      >
        <Server className="h-4 w-4 text-[#9a9590]" />
      </button>
      <button
        onClick={onOpenUsage}
        className="p-1.5 bg-(--card) border border-(--border) rounded hover:bg-(--accent)"
        title="Usage"
      >
        <BarChart3 className="h-4 w-4 text-[#9a9590]" />
      </button>
      <button
        onClick={onOpenExport}
        className="p-1.5 bg-(--card) border border-(--border) rounded hover:bg-(--accent)"
        title="Export"
      >
        <Download className="h-4 w-4 text-[#9a9590]" />
      </button>
    </div>
  );
}
