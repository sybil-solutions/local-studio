// CRITICAL
import type { AgentPlan, AgentPlanStep, AgentTask, AgentTaskStatus } from "@/lib/types";

export type AgentPlanStepStatus = AgentTaskStatus;
export type { AgentPlan, AgentPlanStep, AgentTask, AgentTaskStatus };

const normalizeStatus = (value: unknown): AgentTaskStatus => {
  if (typeof value !== "string") return "pending";
  const normalized = value.toLowerCase();
  if (normalized === "running" || normalized === "done" || normalized === "blocked") {
    return normalized;
  }
  return "pending";
};

export function normalizePlanSteps(
  input: unknown,
  maxSteps = 12,
): AgentPlanStep[] {
  console.log("[normalizePlanSteps] Input:", input, "type:", typeof input, "isArray:", Array.isArray(input));

  // Handle various input formats
  let rawSteps: unknown[] = [];

  if (Array.isArray(input)) {
    rawSteps = input;
  } else if (input && typeof input === "object") {
    const obj = input as Record<string, unknown>;
    // Maybe it's an object with numeric keys like { "0": {...}, "1": {...} }
    const keys = Object.keys(obj);
    if (keys.length > 0 && keys.every(k => !isNaN(parseInt(k, 10)))) {
      rawSteps = keys.sort((a, b) => parseInt(a, 10) - parseInt(b, 10)).map(k => obj[k]);
      console.log("[normalizePlanSteps] Converted object to array:", rawSteps);
    } else if ("tasks" in obj && Array.isArray(obj.tasks)) {
      // Nested tasks array
      rawSteps = obj.tasks as unknown[];
      console.log("[normalizePlanSteps] Extracted nested tasks:", rawSteps);
    } else if ("steps" in obj && Array.isArray(obj.steps)) {
      // Nested steps array
      rawSteps = obj.steps as unknown[];
      console.log("[normalizePlanSteps] Extracted nested steps:", rawSteps);
    }
  } else if (typeof input === "string") {
    // Maybe it's a JSON string
    try {
      const parsed = JSON.parse(input);
      if (Array.isArray(parsed)) {
        rawSteps = parsed;
        console.log("[normalizePlanSteps] Parsed JSON string to array:", rawSteps);
      }
    } catch {
      // Not valid JSON, ignore
    }
  }

  const normalized: AgentPlanStep[] = [];

  for (const step of rawSteps) {
    let title = "";
    let status: AgentTaskStatus = "pending";
    let notes: string | undefined;

    if (typeof step === "string") {
      title = step.trim();
    } else if (step && typeof step === "object") {
      const s = step as Record<string, unknown>;
      if (typeof s.title === "string") title = s.title.trim();
      status = normalizeStatus(s.status);
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

export function normalizeTasks(
  input: unknown,
  maxTasks = 24,
): AgentTask[] {
  const rawTasks = Array.isArray(input) ? input : [];
  const normalized: AgentTask[] = [];

  for (const task of rawTasks) {
    let title = "";
    let status: AgentTaskStatus = "pending";
    let notes: string | undefined;

    if (typeof task === "string") {
      title = task.trim();
    } else if (task && typeof task === "object") {
      const t = task as Record<string, unknown>;
      if (typeof t.title === "string") title = t.title.trim();
      status = normalizeStatus(t.status);
      if (typeof t.notes === "string" && t.notes.trim()) {
        notes = t.notes.trim();
      }
    }

    if (!title) continue;
    normalized.push({
      id: `task-${normalized.length}`,
      title,
      status,
      ...(notes ? { notes } : {}),
    });
    if (normalized.length >= maxTasks) break;
  }
  return normalized;
}
