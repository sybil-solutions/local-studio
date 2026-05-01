export interface OpenAIModelListItem {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
  name?: string;
  context_window?: number;
  contextWindow?: number;
  max_model_len?: number;
  max_tokens?: number;
  maxTokens?: number;
  metadata?: Record<string, unknown>;
  active?: boolean;
  [key: string]: unknown;
}

export interface OpenAIModelsResponse {
  object?: string;
  data?: OpenAIModelListItem[];
}

export interface AgentModel {
  id: string;
  name: string;
  provider: "vllm-studio";
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  active: boolean;
}

export function inferReasoningSupport(modelId: string): boolean {
  const normalized = modelId.toLowerCase();
  return (
    normalized.includes("reason") ||
    normalized.includes("thinking") ||
    normalized.includes("r1") ||
    normalized.includes("deepseek") ||
    normalized.includes("qwen3") ||
    normalized.includes("glm-5") ||
    normalized.includes("mimo")
  );
}

function numberFromUnknown(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

export function normalizeOpenAIModel(model: OpenAIModelListItem): AgentModel {
  const metadata = model.metadata && typeof model.metadata === "object" ? model.metadata : {};
  const id = String(model.id || "").trim();
  const name = String(model.name || metadata.name || id).trim() || id;
  const contextWindow =
    numberFromUnknown(model.contextWindow) ??
    numberFromUnknown(model.context_window) ??
    numberFromUnknown(model.max_model_len) ??
    numberFromUnknown(metadata.contextWindow) ??
    numberFromUnknown(metadata.context_window) ??
    numberFromUnknown(metadata.max_model_len) ??
    128_000;
  const fallbackMaxTokens = Math.min(contextWindow, 65_536);
  const maxTokens =
    numberFromUnknown(model.maxTokens) ??
    numberFromUnknown(model.max_tokens) ??
    numberFromUnknown(metadata.maxTokens) ??
    numberFromUnknown(metadata.max_tokens) ??
    fallbackMaxTokens;
  const explicitReasoning = metadata.reasoning ?? model.reasoning;
  const reasoning =
    typeof explicitReasoning === "boolean" ? explicitReasoning : inferReasoningSupport(id);
  const explicitActive = metadata.active ?? model.active;

  return {
    id,
    name,
    provider: "vllm-studio",
    contextWindow,
    maxTokens,
    reasoning,
    active: explicitActive === true,
  };
}

export function normalizeOpenAIModels(payload: OpenAIModelsResponse): AgentModel[] {
  const rows = Array.isArray(payload.data) ? payload.data : [];
  const seen = new Set<string>();
  const models: AgentModel[] = [];
  for (const row of rows) {
    if (!row || typeof row.id !== "string" || !row.id.trim()) continue;
    const model = normalizeOpenAIModel(row);
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    models.push(model);
  }
  return models.sort((a, b) => a.name.localeCompare(b.name));
}

export function modelsToPiModels(models: AgentModel[]) {
  return models.map((model) => ({
    id: model.id,
    name: model.name,
    reasoning: model.reasoning,
    input: ["text"],
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: model.reasoning,
      maxTokensField: "max_tokens",
    },
  }));
}
