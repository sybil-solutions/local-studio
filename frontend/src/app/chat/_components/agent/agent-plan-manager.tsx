// CRITICAL
"use client";

import { useState } from "react";
import {
  Plus,
  MoreHorizontal,
  CheckCircle2,
  Circle,
  Clock,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Edit3,
  Trash2,
  Play,
  Pause,
  RotateCcw,
  Sparkles,
  Target,
  ListTodo,
  ChevronUp,
  GripVertical,
} from "lucide-react";

export type PlanStatus = "draft" | "active" | "paused" | "completed" | "failed";

export interface PlanStep {
  id: string;
  title: string;
  description?: string;
  status: "pending" | "in-progress" | "completed" | "failed" | "skipped";
  tool?: string;
  dependencies?: string[];
  estimatedTime?: number;
  actualTime?: number;
  output?: string;
  error?: string;
}

export interface Plan {
  id: string;
  title: string;
  description?: string;
  status: PlanStatus;
  steps: PlanStep[];
  createdAt: string;
  updatedAt: string;
  progress: number;
  autoExecute: boolean;
}

interface AgentPlanManagerProps {
  plans: Plan[];
  activePlanId?: string;
  onCreatePlan: (plan: Omit<Plan, "id" | "createdAt" | "updatedAt" | "progress">) => void;
  onUpdatePlan: (id: string, updates: Partial<Plan>) => void;
  onDeletePlan: (id: string) => void;
  onSelectPlan: (id: string) => void;
  onUpdateStep: (planId: string, stepId: string, updates: Partial<PlanStep>) => void;
  onReorderSteps?: (planId: string, stepIds: string[]) => void;
}

function StatusBadge({ status }: { status: PlanStatus }) {
  const styles = {
    draft: "bg-white/[0.03] text-[#888]",
    active: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    paused: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    completed: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    failed: "bg-red-500/10 text-red-400 border-red-500/20",
  };

  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] border ${styles[status]}`}>
      {status}
    </span>
  );
}

function StepStatusIcon({ status }: { status: PlanStep["status"] }) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
    case "in-progress":
      return <Clock className="h-4 w-4 text-amber-400 animate-pulse" />;
    case "failed":
      return <AlertCircle className="h-4 w-4 text-red-400" />;
    case "skipped":
      return <Circle className="h-4 w-4 text-[#444]" />;
    default:
      return <Circle className="h-4 w-4 text-[#555]" />;
  }
}

export function AgentPlanManager({
  plans,
  activePlanId,
  onCreatePlan,
  onUpdatePlan,
  onDeletePlan,
  onSelectPlan,
  onUpdateStep,
}: AgentPlanManagerProps) {
  const [expandedPlans, setExpandedPlans] = useState<Set<string>>(new Set());
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingPlan, setEditingPlan] = useState<string | null>(null);
  const [newPlanTitle, setNewPlanTitle] = useState("");
  const [newPlanDescription, setNewPlanDescription] = useState("");

  const toggleExpanded = (planId: string) => {
    setExpandedPlans((prev) => {
      const next = new Set(prev);
      if (next.has(planId)) {
        next.delete(planId);
      } else {
        next.add(planId);
      }
      return next;
    });
  };

  const handleCreatePlan = () => {
    if (!newPlanTitle.trim()) return;
    onCreatePlan({
      title: newPlanTitle,
      description: newPlanDescription,
      status: "draft",
      steps: [],
      autoExecute: false,
    });
    setNewPlanTitle("");
    setNewPlanDescription("");
    setShowCreateModal(false);
  };

  const activePlan = plans.find((p) => p.id === activePlanId);
  const completedPlans = plans.filter((p) => p.status === "completed");
  const draftPlans = plans.filter((p) => p.status === "draft");

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-violet-400" />
          <span className="text-xs font-medium text-[#888]">Plans</span>
          <span className="text-[10px] text-[#555] bg-white/[0.03] px-1.5 py-0.5 rounded">
            {plans.length}
          </span>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-1 px-2 py-1 text-[11px] bg-violet-500/20 text-violet-300 rounded hover:bg-violet-500/30 transition-colors"
        >
          <Plus className="h-3 w-3" />
          New
        </button>
      </div>

      {/* Active Plan Section */}
      {activePlan && (
        <div className="px-3 py-2 border-b border-white/[0.06] bg-violet-500/5">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="h-3.5 w-3.5 text-violet-400" />
            <span className="text-[11px] font-medium text-violet-300">Active</span>
          </div>
          <div className="p-2 rounded-lg bg-white/[0.03] border border-violet-500/20">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-foreground truncate">{activePlan.title}</span>
              <StatusBadge status={activePlan.status} />
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all"
                  style={{ width: `${activePlan.progress}%` }}
                />
              </div>
              <span className="text-[10px] text-[#666]">{activePlan.progress}%</span>
            </div>
          </div>
        </div>
      )}

      {/* Plans List */}
      <div className="flex-1 overflow-y-auto">
        {/* Draft Plans */}
        {draftPlans.length > 0 && (
          <div className="px-3 py-2">
            <div className="flex items-center gap-2 mb-2">
              <ListTodo className="h-3 w-3 text-[#666]" />
              <span className="text-[10px] font-medium text-[#666] uppercase tracking-wider">Drafts</span>
            </div>
            {draftPlans.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                isExpanded={expandedPlans.has(plan.id)}
                isActive={plan.id === activePlanId}
                onToggle={() => toggleExpanded(plan.id)}
                onSelect={() => onSelectPlan(plan.id)}
                onUpdate={(updates) => onUpdatePlan(plan.id, updates)}
                onDelete={() => onDeletePlan(plan.id)}
                onUpdateStep={(stepId, updates) => onUpdateStep(plan.id, stepId, updates)}
              />
            ))}
          </div>
        )}

        {/* Completed Plans */}
        {completedPlans.length > 0 && (
          <div className="px-3 py-2 border-t border-white/[0.06]">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="h-3 w-3 text-[#666]" />
              <span className="text-[10px] font-medium text-[#666] uppercase tracking-wider">Completed</span>
            </div>
            {completedPlans.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                isExpanded={expandedPlans.has(plan.id)}
                isActive={plan.id === activePlanId}
                onToggle={() => toggleExpanded(plan.id)}
                onSelect={() => onSelectPlan(plan.id)}
                onUpdate={(updates) => onUpdatePlan(plan.id, updates)}
                onDelete={() => onDeletePlan(plan.id)}
                onUpdateStep={(stepId, updates) => onUpdateStep(plan.id, stepId, updates)}
              />
            ))}
          </div>
        )}

        {plans.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Target className="h-10 w-10 text-[#333] mb-3" />
            <p className="text-xs text-[#555] mb-1">No plans yet</p>
            <p className="text-[10px] text-[#444] max-w-[180px]">
              Create a plan to break down complex tasks into manageable steps
            </p>
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#111] border border-white/[0.06] rounded-xl p-4">
            <h3 className="text-sm font-medium text-foreground mb-4">Create New Plan</h3>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] text-[#888] mb-1 block">Title</label>
                <input
                  type="text"
                  value={newPlanTitle}
                  onChange={(e) => setNewPlanTitle(e.target.value)}
                  placeholder="e.g., Build a React app"
                  className="w-full px-3 py-2 text-xs bg-white/[0.03] border border-white/[0.06] rounded-lg text-foreground placeholder:text-[#555] focus:outline-none focus:border-white/[0.12]"
                />
              </div>
              <div>
                <label className="text-[11px] text-[#888] mb-1 block">Description (optional)</label>
                <textarea
                  value={newPlanDescription}
                  onChange={(e) => setNewPlanDescription(e.target.value)}
                  placeholder="What do you want to accomplish?"
                  rows={3}
                  className="w-full px-3 py-2 text-xs bg-white/[0.03] border border-white/[0.06] rounded-lg text-foreground placeholder:text-[#555] focus:outline-none focus:border-white/[0.12] resize-none"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-3 py-1.5 text-[11px] text-[#888] hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreatePlan}
                className="px-3 py-1.5 text-[11px] bg-violet-500/20 text-violet-300 rounded-lg hover:bg-violet-500/30 transition-colors"
              >
                Create Plan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PlanCard({
  plan,
  isExpanded,
  isActive,
  onToggle,
  onSelect,
  onUpdate,
  onDelete,
  onUpdateStep,
}: {
  plan: Plan;
  isExpanded: boolean;
  isActive: boolean;
  onToggle: () => void;
  onSelect: () => void;
  onUpdate: (updates: Partial<Plan>) => void;
  onDelete: () => void;
  onUpdateStep: (stepId: string, updates: Partial<PlanStep>) => void;
}) {
  const [showMenu, setShowMenu] = useState(false);

  const completedSteps = plan.steps.filter((s) => s.status === "completed").length;
  const inProgressSteps = plan.steps.filter((s) => s.status === "in-progress").length;

  return (
    <div
      className={`mb-2 rounded-lg border transition-colors ${
        isActive
          ? "bg-violet-500/5 border-violet-500/20"
          : "bg-white/[0.02] border-white/[0.04] hover:border-white/[0.08]"
      }`}
    >
      <div className="flex items-center gap-2 px-2 py-2">
        <button onClick={onToggle} className="p-0.5 text-[#555]">
          {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <div className="flex-1 min-w-0 cursor-pointer" onClick={onSelect}>
          <div className="text-xs text-foreground truncate">{plan.title}</div>
          <div className="flex items-center gap-2 mt-0.5">
            <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden max-w-[60px]">
              <div
                className="h-full bg-[#666] transition-all"
                style={{ width: `${plan.progress}%` }}
              />
            </div>
            <span className="text-[10px] text-[#555]">
              {completedSteps}/{plan.steps.length}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {plan.status === "active" && (
            <button
              onClick={() => onUpdate({ status: "paused" })}
              className="p-1 rounded hover:bg-white/[0.06] text-[#666]"
            >
              <Pause className="h-3 w-3" />
            </button>
          )}
          {plan.status === "paused" && (
            <button
              onClick={() => onUpdate({ status: "active" })}
              className="p-1 rounded hover:bg-white/[0.06] text-emerald-400"
            >
              <Play className="h-3 w-3" />
            </button>
          )}
          {plan.status === "draft" && (
            <button
              onClick={() => onUpdate({ status: "active" })}
              className="p-1 rounded hover:bg-white/[0.06] text-emerald-400"
            >
              <Play className="h-3 w-3" />
            </button>
          )}
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="p-1 rounded hover:bg-white/[0.06] text-[#555]"
            >
              <MoreHorizontal className="h-3 w-3" />
            </button>
            {showMenu && (
              <div className="absolute right-0 top-full mt-1 w-32 bg-[#151515] border border-white/[0.06] rounded-lg shadow-xl z-10">
                <button
                  onClick={() => {
                    onUpdate({ status: "draft" });
                    setShowMenu(false);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-[#888] hover:bg-white/[0.04]"
                >
                  <RotateCcw className="h-3 w-3" />
                  Reset
                </button>
                <button
                  onClick={() => {
                    onDelete();
                    setShowMenu(false);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-red-400 hover:bg-white/[0.04]"
                >
                  <Trash2 className="h-3 w-3" />
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {isExpanded && plan.steps.length > 0 && (
        <div className="px-2 pb-2 border-t border-white/[0.04]">
          <div className="pt-2 space-y-1">
            {plan.steps.map((step, index) => (
              <div
                key={step.id}
                className="flex items-start gap-2 p-1.5 rounded hover:bg-white/[0.03]"
              >
                <GripVertical className="h-3 w-3 text-[#444] mt-0.5 cursor-grab" />
                <div className="mt-0.5">
                  <StepStatusIcon status={step.status} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] text-[#aaa] truncate">{step.title}</div>
                  {step.description && (
                    <div className="text-[10px] text-[#555] truncate">{step.description}</div>
                  )}
                  {step.tool && step.status === "in-progress" && (
                    <div className="flex items-center gap-1 mt-1">
                      <span className="text-[9px] px-1 py-0.5 rounded bg-white/[0.05] text-[#666]">
                        {step.tool}
                      </span>
                    </div>
                  )}
                </div>
                {step.status === "pending" && (
                  <button
                    onClick={() => onUpdateStep(step.id, { status: "completed" })}
                    className="p-1 rounded hover:bg-white/[0.06] text-[#444]"
                  >
                    <CheckCircle2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default AgentPlanManager;
