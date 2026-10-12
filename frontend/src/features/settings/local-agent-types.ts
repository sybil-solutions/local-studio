export type LocalAgentId = "pi" | "opencode" | "droid" | "hermes" | "omp";

export const LOCAL_AGENT_IDS: readonly LocalAgentId[] = [
  "pi",
  "opencode",
  "droid",
  "hermes",
  "omp",
];

export interface LocalAgentTarget {
  agent: LocalAgentId;
  label: string;
  /** Resolved config file path used for display (and, for pi/droid, writes). */
  configPath: string;
  /** Whether the config file itself already exists. */
  exists: boolean;
}

export interface LocalAgentModel {
  modelId: string;
  displayName: string;
  baseUrl: string;
  apiKey: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  images: boolean;
}

export interface AttachModelInput {
  home: string;
  targets: LocalAgentId[];
  model: LocalAgentModel;
}

export type AttachAction = "created-file" | "added" | "updated";

export interface AttachExtraUpdate {
  configPath: string;
  backupPath?: string;
}

export interface AttachResult {
  agent: LocalAgentId;
  ok: boolean;
  configPath: string;
  backupPath?: string;
  action?: AttachAction;
  error?: string;
  extraUpdates?: AttachExtraUpdate[];
}
