// CRITICAL
"use client";

import { useCallback, useMemo } from "react";
import { useAppStore } from "@/store";
import { normalizePlanSteps } from "../_components/agent/agent-types";
import type { AgentPlan, AgentPlanStep } from "../_components/agent/agent-types";

/**
 * Synthetic tool definitions injected when agent mode is on.
 * The model calls set_plan to create a checklist, then update_plan
 * to mark each step done/running/blocked as it works.
 */
const SET_PLAN_TOOL = {
  name: "set_plan",
  server: "__agent__",
  description:
    "Create or replace the execution plan. Call this BEFORE doing any work. " +
    "Each step should be a concrete, actionable task. " +
    "After creating the plan, proceed to execute step 0.",
  inputSchema: {
    type: "object" as const,
    properties: {
      steps: {
        type: "array" as const,
        description: "Array of plan steps",
        items: {
          type: "object" as const,
          properties: {
            title: {
              type: "string" as const,
              description: "Short description of this step",
            },
          },
          required: ["title"],
        },
      },
    },
    required: ["steps"],
  },
};

const UPDATE_PLAN_TOOL = {
  name: "update_plan",
  server: "__agent__",
  description:
    "Update a plan step's status. Call this after completing each step " +
    'to mark it "done", or "blocked" if it cannot proceed. ' +
    "Always update the current step before moving to the next one.",
  inputSchema: {
    type: "object" as const,
    properties: {
      step_index: {
        type: "number" as const,
        description: "Zero-based index of the step to update",
      },
      status: {
        type: "string" as const,
        enum: ["done", "running", "blocked"],
        description: "New status for the step",
      },
      notes: {
        type: "string" as const,
        description: "Optional notes about the result of this step",
      },
    },
    required: ["step_index", "status"],
  },
};

export function useAgentTools() {
  const agentPlan = useAppStore((s) => s.agentPlan);
  const setAgentPlan = useAppStore((s) => s.setAgentPlan);

  /** The two tool defs to merge into the tool list */
  const agentToolDefs = useMemo(() => [SET_PLAN_TOOL, UPDATE_PLAN_TOOL], []);

  /** Handle a synthetic agent tool call. Returns the tool result string. */
  const executeAgentTool = useCallback(
    (toolName: string, args: Record<string, unknown>): string | null => {
      if (toolName === "set_plan") {
        const steps = normalizePlanSteps(args.steps);
        if (steps.length === 0) {
          return JSON.stringify({
            success: false,
            error:
              "Plan must include a steps array with a title for each step.",
            hint: 'Example: set_plan({ steps: [{ title: "Research topic" }, { title: "Draft outline" }] })',
          });
        }
        const plan: AgentPlan = {
          steps,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        setAgentPlan(plan);
        return JSON.stringify({
          success: true,
          plan: { steps: plan.steps },
          message: `Plan created with ${steps.length} steps. Proceed to execute step 0.`,
        });
      }

      if (toolName === "update_plan") {
        if (!agentPlan) {
          return JSON.stringify({
            success: false,
            error: "No active plan. Call set_plan first.",
          });
        }
        const rawIdx = args.step_index;
        const idx =
          typeof rawIdx === "number"
            ? rawIdx
            : typeof rawIdx === "string"
              ? parseInt(rawIdx, 10)
              : -1;
        const maxIdx = agentPlan.steps.length - 1;
        if (!Number.isFinite(idx) || idx < 0 || idx > maxIdx) {
          return JSON.stringify({
            success: false,
            error: `Invalid step_index: ${idx}. Valid range is 0–${maxIdx}.`,
            currentPlan: agentPlan.steps.map(
              (s, i) => `${i}: ${s.title} [${s.status}]`,
            ),
          });
        }
        const rawStatus =
          typeof args.status === "string" ? args.status : "done";
        const status: AgentPlanStep["status"] =
          rawStatus === "running" || rawStatus === "done" || rawStatus === "blocked"
            ? rawStatus
            : "done";

        const notes =
          typeof args.notes === "string" && args.notes.trim()
            ? args.notes.trim()
            : undefined;

        const updatedSteps = agentPlan.steps.map((s, i) =>
          i === idx ? { ...s, status, ...(notes ? { notes } : {}) } : s,
        );
        setAgentPlan({
          ...agentPlan,
          steps: updatedSteps,
          updatedAt: Date.now(),
        });

        const doneCount = updatedSteps.filter(
          (s) => s.status === "done",
        ).length;
        const nextIdx = updatedSteps.findIndex(
          (s) => s.status !== "done",
        );

        return JSON.stringify({
          success: true,
          step: idx,
          status,
          progress: `${doneCount}/${updatedSteps.length}`,
          ...(nextIdx >= 0
            ? { nextStep: nextIdx, nextTitle: updatedSteps[nextIdx].title }
            : { allDone: true }),
        });
      }

      return null; // not an agent tool
    },
    [agentPlan, setAgentPlan],
  );

  /** Check if a tool name is a synthetic agent tool */
  const isAgentTool = useCallback(
    (toolName: string) =>
      toolName === "set_plan" || toolName === "update_plan",
    [],
  );

  /** Build the agent system-prompt section injected when agent mode is on */
  const buildAgentSystemPrompt = useCallback((): string => {
    const lines: string[] = [];

    lines.push("<agent_mode>");
    lines.push("You are in AGENT MODE. You have access to tools and MUST follow this workflow:");
    lines.push("");
    lines.push("1. ALWAYS call set_plan first to create a step-by-step plan before doing any work.");
    lines.push("2. Execute each step using available tools.");
    lines.push('3. After completing each step, call update_plan to mark it "done".');
    lines.push("4. If a step is blocked, mark it \"blocked\" and move to the next feasible step.");
    lines.push("5. After all steps are done, provide a final summary of results.");
    lines.push("");
    lines.push("Plans should have 3–8 concrete, actionable steps.");
    lines.push("Do NOT skip calling set_plan. Do NOT describe actions you could take — execute them.");

    if (agentPlan && agentPlan.steps.length > 0) {
      const steps = agentPlan.steps;
      const doneCount = steps.filter((s) => s.status === "done").length;
      const currentIdx = steps.findIndex((s) => s.status !== "done");
      const planLines = steps.map((s, i) => {
        const marker =
          s.status === "done"
            ? "[x]"
            : i === currentIdx
              ? "[>]"
              : s.status === "blocked"
                ? "[!]"
                : "[ ]";
        return `  ${marker} ${i}: ${s.title}`;
      });

      lines.push("");
      lines.push("<current_plan>");
      lines.push(`Progress: ${doneCount}/${steps.length}`);
      lines.push(...planLines);
      if (currentIdx >= 0) {
        lines.push(`Current step: ${currentIdx} — ${steps[currentIdx].title}`);
      } else {
        lines.push("All steps complete. Provide final summary.");
      }
      lines.push("</current_plan>");
    }

    lines.push("</agent_mode>");
    return lines.join("\n");
  }, [agentPlan]);

  return {
    agentToolDefs,
    executeAgentTool,
    isAgentTool,
    buildAgentSystemPrompt,
    agentPlan,
    clearPlan: useCallback(() => setAgentPlan(null), [setAgentPlan]),
  };
}
