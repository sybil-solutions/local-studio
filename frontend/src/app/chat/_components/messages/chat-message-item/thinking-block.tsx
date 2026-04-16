// CRITICAL
"use client";

import { memo, useCallback, useState } from "react";
import { Brain, ChevronRight, Loader2 } from "lucide-react";

interface ThinkingBlockProps {
  content: string;
  isActive: boolean;
}

export const ThinkingBlock = memo(function ThinkingBlock({ content, isActive }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded(p => !p), []);

  if (!content && !isActive) return null;

  return (
    <div className="my-1.5">
      <button
        onClick={toggle}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-(--fg)/[0.03] transition-colors text-left"
      >
        {isActive
          ? <Loader2 className="w-3 h-3 text-(--dim) animate-spin shrink-0" />
          : <Brain className="w-3 h-3 text-(--dim)/50 shrink-0" />
        }
        <span className={`text-[11px] ${isActive ? "text-(--dim)" : "text-(--dim)/60"}`}>
          {isActive ? "Thinking..." : "Thought for a few seconds"}
        </span>
        <ChevronRight className={`w-3 h-3 text-(--dim)/40 shrink-0 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`} />
      </button>
      <div className={`overflow-hidden transition-all duration-200 ease-out ${expanded ? "max-h-[200px] opacity-100" : "max-h-0 opacity-0"}`}>
        <div className="ml-5 mt-1 pl-2.5 border-l border-(--border) text-[11px] leading-[1.6] text-(--dim)/70 overflow-y-auto max-h-[180px]">
          <p className="whitespace-pre-wrap break-words">
            {content}
            {isActive && <span className="inline-block w-px h-3 bg-(--fg) animate-[blink_1s_step-end_infinite] align-middle ml-0.5" />}
          </p>
        </div>
      </div>
    </div>
  );
});
