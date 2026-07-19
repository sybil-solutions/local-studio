export const DEFAULT_AGENT_MODEL_KEY = "local-studio.agent.defaultModel";

export function readDefaultAgentModel(storage: Pick<Storage, "getItem">): string {
  return storage.getItem(DEFAULT_AGENT_MODEL_KEY)?.trim() ?? "";
}

export function writeDefaultAgentModel(storage: Pick<Storage, "setItem">, modelId: string): void {
  storage.setItem(DEFAULT_AGENT_MODEL_KEY, modelId);
}
