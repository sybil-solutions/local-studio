import type { AgentModel } from "@/features/agent/workspace/types";

export type VisibleAgentModels = {
  controllerModels: AgentModel[];
  otherModels: AgentModel[];
  visibleModels: AgentModel[];
};

export function splitVisibleAgentModels(
  models: AgentModel[],
  showOtherModels: boolean,
): VisibleAgentModels {
  const controllerModels: AgentModel[] = [];
  const otherModels: AgentModel[] = [];
  for (const model of models) {
    (model.controllerUrl ? controllerModels : otherModels).push(model);
  }
  return {
    controllerModels,
    otherModels,
    // With no controller models at all, an empty picker helps nobody — fall
    // back to the other models even when they are toggled off.
    visibleModels:
      showOtherModels || controllerModels.length === 0
        ? [...controllerModels, ...otherModels]
        : controllerModels,
  };
}
