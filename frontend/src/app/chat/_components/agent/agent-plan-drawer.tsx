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
import type { AgentPlan, AgentPlanStep } from "./agent-types";

interface AgentPlanDrawerProps {
  plan: AgentPlan;
  onClear: () => void;
}

function StepIcon({ status }: { status: AgentPlanStep["status"] }) {
  switch (status) {
    case "done":
      return (
        <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
          <Check className="h-3 w-3 text-emerald-400" />
        </div>
      );
    case "running":
      return (
        <div className="w-5 h-5 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0">
          <Loader2 className="h-3 w-3 text-blue-400 animate-spin" />
        </div>
      );
    case "blocked":
      return (
        <div className="w-5 h-5 rounded-full bg-red-500/15 flex items-center justify-center flex-shrink-0">
          <Ban className="h-3 w-3 text-red-400" />
        </div>
      );
    default:
      return (
        <div className="w-5 h-5 rounded-full border border-white/10 flex items-center justify-center flex-shrink-0">
          <Circle className="h-2.5 w-2.5 text-[#444]" />
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
  const progressPct =
    steps.length > 0 ? Math.round((doneCount / steps.length) * 100) : 0;

  return (
    <div className="border border-white/[0.06] rounded-lg bg-[#0c0c0c] overflow-hidden mb-3">
      {/* Header — always visible */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-white/[0.02] transition-colors"
      >
        <ListChecks className="h-4 w-4 text-violet-400 flex-shrink-0" />

        <div className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-[#ccc]">Plan</span>
            <span className="text-[10px] text-[#666]">
              {allDone
                ? `${steps.length} steps · Done`
                : `${doneCount}/${steps.length} steps`}
            </span>
          </div>
          {/* Progress bar */}
          <div className="mt-1.5 h-1 w-full rounded-full bg-white/5 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                allDone
                  ? "bg-emerald-500"
                  : "bg-gradient-to-r from-violet-500 to-blue-500"
              }`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
            className="p-1 rounded hover:bg-white/[0.06] text-[#555] hover:text-[#999]"
            title="Clear plan"
          >
            <X className="h-3 w-3" />
          </button>
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5 text-[#555]" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-[#555]" />
          )}
        </div>
      </button>

      {/* Steps checklist */}
      {!collapsed && (
        <div className="px-3 pb-3 space-y-0.5">
          {steps.map((step, i) => {
            const isCurrent = i === currentIndex && step.status !== "blocked";
            return (
              <div
                key={step.id}
                className={`flex items-start gap-2.5 py-1.5 px-2 rounded-md transition-colors ${
                  isCurrent
                    ? "bg-white/[0.03]"
                    : step.status === "done"
                      ? "opacity-60"
                      : ""
                }`}
              >
                <StepIcon status={step.status} />
                <div className="flex-1 min-w-0 pt-0.5">
                  <span
                    className={`text-xs leading-relaxed ${
                      step.status === "done"
                        ? "text-[#777] line-through decoration-[#555]"
                        : isCurrent
                          ? "text-[#ddd]"
                          : "text-[#999]"
                    }`}
                  >
                    {step.title}
                  </span>
                  {step.notes && (
                    <p className="text-[10px] text-[#555] mt-0.5 leading-relaxed">
                      {step.notes}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
