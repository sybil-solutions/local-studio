// CRITICAL
"use client";

import { useState } from "react";
import {
  Check,
  Circle,
  Loader2,
  Ban,
  ChevronDown,
  ChevronRight,
  X,
  ListChecks,
} from "lucide-react";
import * as Icons from "../icons";
import type { AgentPlan, AgentPlanStep } from "./agent-types";

interface AgentPlanDrawerProps {
  plan: AgentPlan;
  onClear: () => void;
}

function StepIcon({ status }: { status: AgentPlanStep["status"] }) {
  switch (status) {
    case "done":
      return (
        <div className="w-[18px] h-[18px] rounded bg-emerald-500/20 flex items-center justify-center shrink-0">
          <Icons.Check className="h-3 w-3 text-emerald-400" strokeWidth={2.5} />
        </div>
      );
    case "running":
      return (
        <div className="w-[18px] h-[18px] rounded bg-blue-500/20 flex items-center justify-center shrink-0">
          <Icons.Loader2 className="h-3 w-3 text-blue-400 animate-spin" />
        </div>
      );
    case "blocked":
      return (
        <div className="w-[18px] h-[18px] rounded bg-red-500/15 flex items-center justify-center shrink-0">
          <Ban className="h-2.5 w-2.5 text-red-400" />
        </div>
      );
    default:
      return (
        <div className="w-[18px] h-[18px] rounded border border-white/[0.08] flex items-center justify-center shrink-0">
          <Icons.Circle className="h-2 w-2 text-[#444]" />
        </div>
      );
  }
}

export function AgentPlanDrawer({ plan, onClear }: AgentPlanDrawerProps) {
  const [collapsed, setCollapsed] = useState(false);

  const { steps } = plan;
  const doneCount = steps.filter((s) => s.status === "done").length;
  const allDone = doneCount === steps.length;
  const currentIndex = steps.findIndex((s) => s.status !== "done");

  return (
    <div className="border-b border-white/[0.06] bg-[#111] overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-white/[0.02] transition-colors"
      >
        {collapsed ? (
          <Icons.ChevronRight className="h-3 w-3 text-[#555] shrink-0" />
        ) : (
          <Icons.ChevronDown className="h-3 w-3 text-[#555] shrink-0" />
        )}

        <ListChecks className="h-3.5 w-3.5 text-violet-400 shrink-0" />

        <span className="text-[11px] font-medium text-[#aaa]">Plan</span>

        <span className="text-[10px] text-[#555] font-mono">
          {allDone ? `${steps.length} steps · Done` : `${doneCount}/${steps.length} steps`}
        </span>

        {/* Mini progress dots */}
        <div className="flex gap-[3px] ml-auto mr-1">
          {steps.map((s, i) => (
            <div
              key={i}
              className={`w-1.5 h-1.5 rounded-full transition-colors ${
                s.status === "done"
                  ? "bg-emerald-500"
                  : s.status === "running"
                    ? "bg-blue-400 animate-pulse"
                    : s.status === "blocked"
                      ? "bg-red-400"
                      : "bg-white/[0.08]"
              }`}
            />
          ))}
        </div>

        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              onClear();
            }
          }}
          className="p-0.5 rounded hover:bg-white/[0.06] text-[#444] hover:text-[#888] shrink-0 cursor-pointer"
          title="Clear plan"
        >
          <Icons.X className="h-3 w-3" />
        </span>
      </button>

      {/* Steps */}
      {!collapsed && (
        <div className="px-3 pb-2 space-y-[2px]">
          {steps.map((step, i) => {
            const isCurrent = i === currentIndex && step.status !== "blocked";
            return (
              <div
                key={step.id}
                className={`flex items-center gap-2 py-1 px-1.5 rounded transition-colors ${
                  isCurrent ? "bg-white/[0.03]" : ""
                }`}
              >
                <StepIcon status={step.status} />
                <span
                  className={`text-[11px] leading-snug truncate ${
                    step.status === "done"
                      ? "text-[#555] line-through decoration-[#444]"
                      : isCurrent
                        ? "text-[#ccc]"
                        : "text-[#888]"
                  }`}
                >
                  {step.title}
                </span>
                {step.notes && (
                  <span className="text-[10px] text-[#444] truncate ml-auto shrink-0 max-w-[120px]">
                    {step.notes}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
