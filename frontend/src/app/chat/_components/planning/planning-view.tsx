"use client";

import { useState } from "react";
import {
  Lightbulb,
  Search,
  Code,
  FileText,
  CheckCircle2,
  Circle,
  Loader2,
  Sparkles,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

export type PlanStepStatus = "pending" | "in-progress" | "completed" | "error";

export interface PlanStep {
  id: string;
  title: string;
  description?: string;
  status: PlanStepStatus;
  tool?: string;
  result?: string;
}

export interface Plan {
  id: string;
  title: string;
  steps: PlanStep[];
  isActive: boolean;
}

interface PlanningViewProps {
  plan?: Plan;
  onToggle?: () => void;
}

const stepIcons: Record<string, typeof Search> = {
  search: Search,
  research: Search,
  analyze: Lightbulb,
  think: Lightbulb,
  code: Code,
  generate: Code,
  write: FileText,
  read: FileText,
  default: Sparkles,
};

function getStepIcon(tool?: string) {
  if (!tool) return Sparkles;
  const normalized = tool.toLowerCase();
  for (const [key, icon] of Object.entries(stepIcons)) {
    if (normalized.includes(key)) return icon;
  }
  return stepIcons.default;
}

function StatusIcon({ status }: { status: PlanStepStatus }) {
  switch (status) {
    case "completed":
      return (
        <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center">
          <CheckCircle2 className="h-3 w-3 text-emerald-400" />
        </div>
      );
    case "in-progress":
      return (
        <div className="w-5 h-5 rounded-full bg-amber-500/20 flex items-center justify-center">
          <Loader2 className="h-3 w-3 text-amber-400 animate-spin" />
        </div>
      );
    case "error":
      return (
        <div className="w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center">
          <Circle className="h-3 w-3 text-red-400" />
        </div>
      );
    default:
      return (
        <div className="w-5 h-5 rounded-full border border-white/10 flex items-center justify-center">
          <Circle className="h-3 w-3 text-[#555]" />
        </div>
      );
  }
}

export function PlanningView({ plan, onToggle }: PlanningViewProps) {
  const [expanded, setExpanded] = useState(true);

  if (!plan || plan.steps.length === 0) return null;

  const completedCount = plan.steps.filter((s) => s.status === "completed").length;
  const progress = Math.round((completedCount / plan.steps.length) * 100);

  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#0c0c0c] overflow-hidden mb-4">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 flex items-center justify-center">
            <Sparkles className="h-4 w-4 text-violet-400" />
          </div>
          <div className="text-left">
            <div className="text-sm font-medium text-foreground">{plan.title}</div>
            <div className="text-xs text-[#666]">
              {completedCount} of {plan.steps.length} steps complete
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Progress bar */}
          <div className="hidden sm:flex items-center gap-2">
            <div className="w-20 h-1.5 rounded-full bg-white/5">
              <div
                className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-xs text-[#666]">{progress}%</span>
          </div>

          {expanded ? (
            <ChevronUp className="h-4 w-4 text-[#666]" />
          ) : (
            <ChevronDown className="h-4 w-4 text-[#666]" />
          )}
        </div>
      </button>

      {/* Steps */}
      {expanded && (
        <div className="px-4 pb-4 space-y-1">
          {plan.steps.map((step, index) => {
            const Icon = getStepIcon(step.tool);
            const isLast = index === plan.steps.length - 1;

            return (
              <div
                key={step.id}
                className={`flex items-start gap-3 py-2 px-2 rounded-lg transition-colors ${
                  step.status === "in-progress" ? "bg-white/[0.03]" : "hover:bg-white/[0.02]"
                }`}
              >
                <div className="flex flex-col items-center">
                  <StatusIcon status={step.status} />
                  {!isLast && (
                    <div className="w-px h-full min-h-[24px] bg-white/5 mt-1" />
                  )}
                </div>

                <div className="flex-1 min-w-0 pt-0.5">
                  <div className="flex items-center gap-2">
                    <Icon className="h-3.5 w-3.5 text-[#666]" />
                    <span
                      className={`text-sm ${
                        step.status === "completed"
                          ? "text-[#888]"
                          : step.status === "in-progress"
                          ? "text-foreground"
                          : "text-[#666]"
                      }`}
                    >
                      {step.title}
                    </span>
                  </div>

                  {step.description && step.status !== "pending" && (
                    <p className="text-xs text-[#555] mt-1 line-clamp-2">{step.description}</p>
                  )}

                  {step.status === "in-progress" && step.tool && (
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-[#666]">
                        {step.tool}
                      </span>
                    </div>
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
