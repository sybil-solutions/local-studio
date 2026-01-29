// CRITICAL
"use client";

import { useCallback } from "react";
import { api } from "@/lib/api";
import type { AgentState, AgentPlan, ChatSessionDetail } from "@/lib/types";
import { useAppStore } from "@/store";
import { normalizePlanSteps } from "../_components/agent/agent-types";

const normalizePlan = (value: unknown): AgentPlan | null => {
  if (!value || typeof value !== "object") return null;
  const plan = value as Partial<AgentPlan> & { tasks?: unknown };
  const steps = normalizePlanSteps(plan.steps ?? plan.tasks);
  if (steps.length === 0) return null;
  return {
    steps,
    createdAt: typeof plan.createdAt === "number" ? plan.createdAt : Date.now(),
    updatedAt: typeof plan.updatedAt === "number" ? plan.updatedAt : Date.now(),
  };
};

export function useAgentState() {
  const setAgentPlan = useAppStore((state) => state.setAgentPlan);

  const hydrateAgentState = useCallback(
    (session: ChatSessionDetail | null) => {
      const rawState = session?.agent_state ?? null;
      if (!rawState || typeof rawState !== "object") {
        setAgentPlan(null);
        return;
      }
      const agentState = rawState as AgentState;
      const plan = normalizePlan(agentState.plan) ?? normalizePlan({ steps: agentState.tasks });
      setAgentPlan(plan);
    },
    [setAgentPlan],
  );

  const buildAgentState = useCallback(
    (plan: AgentPlan | null): AgentState => ({
      plan: plan ?? null,
      // Back-compat: older controller/client codepaths may only understand `tasks`.
      tasks: plan?.steps ?? undefined,
    }),
    [],
  );

  const persistAgentState = useCallback(
    async (sessionId: string, state: AgentState) => {
      await api.updateChatSession(sessionId, { agent_state: state });
    },
    [],
  );

  return {
    hydrateAgentState,
    persistAgentState,
    buildAgentState,
  };
}
