export type AgentPlanStepStatus = "pending" | "running" | "done" | "blocked";

export interface AgentPlanStep {
  id: string;
  title: string;
  status: AgentPlanStepStatus;
  notes?: string;
}

export interface AgentPlan {
  steps: AgentPlanStep[];
  createdAt: number;
  updatedAt: number;
}

export function normalizePlanSteps(
  input: unknown,
  maxSteps = 12,
): AgentPlanStep[] {
  const rawSteps = Array.isArray(input) ? input : [];
  const normalized: AgentPlanStep[] = [];

  for (const step of rawSteps) {
    let title = "";
    let status: AgentPlanStepStatus = "pending";
    let notes: string | undefined;

    if (typeof step === "string") {
      title = step.trim();
    } else if (step && typeof step === "object") {
      const s = step as Record<string, unknown>;
      if (typeof s.title === "string") title = s.title.trim();
      if (typeof s.status === "string") {
        const v = s.status.toLowerCase();
        if (v === "running" || v === "done" || v === "blocked") {
          status = v;
        }
      }
      if (typeof s.notes === "string" && s.notes.trim()) {
        notes = s.notes.trim();
      }
    }

    if (!title) continue;
    normalized.push({
      id: `step-${normalized.length}`,
      title,
      status,
      ...(notes ? { notes } : {}),
    });
    if (normalized.length >= maxSteps) break;
  }
  return normalized;
}
