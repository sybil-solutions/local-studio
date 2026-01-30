"use client";

import * as Icons from "../icons";
import { cn } from "@/lib/utils";

interface AgentModeToggleProps {
  enabled: boolean;
  onToggle: () => void;
}

export function AgentModeToggle({ enabled, onToggle }: AgentModeToggleProps) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
        enabled
          ? "bg-gradient-to-r from-violet-500/20 to-fuchsia-500/20 text-violet-300 border border-violet-500/30"
          : "bg-white/[0.03] text-[#888] border border-white/[0.06] hover:bg-white/[0.06]",
      )}
    >
      {enabled ? (
        <>
          <Icons.Sparkles className="h-3.5 w-3.5 animate-pulse" />
          <span>Agent Mode</span>
        </>
      ) : (
        <>
          <Icons.Bot className="h-3.5 w-3.5" />
          <span>Agent</span>
        </>
      )}
    </button>
  );
}
