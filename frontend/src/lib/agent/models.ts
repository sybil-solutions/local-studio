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
  vision: boolean;
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

export function inferVisionSupport(modelId: string): boolean {
  const normalized = modelId.toLowerCase();
  return normalized.includes("mimo-v2.5") || normalized.includes("mimo-v2-5");
}

function numberFromUnknown(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

function booleanFromUnknown(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return undefined;
}

function hasImageInput(value: unknown): boolean | undefined {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const normalized = values
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (normalized.length === 0) return undefined;
  return normalized.some((entry) => entry === "image" || entry === "vision");
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function normalizeOpenAIModel(model: OpenAIModelListItem): AgentModel {
  const metadata = recordFromUnknown(model.metadata);
  const capabilities = recordFromUnknown(metadata.capabilities);
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
  const explicitVision =
    booleanFromUnknown(metadata.vision) ??
    booleanFromUnknown(metadata.supportsVision) ??
    booleanFromUnknown(metadata.supports_vision) ??
    booleanFromUnknown(metadata.multimodal) ??
    booleanFromUnknown(capabilities.vision) ??
    booleanFromUnknown(capabilities.image) ??
    hasImageInput(metadata.input) ??
    hasImageInput(metadata.inputs) ??
    hasImageInput(metadata.modalities) ??
    hasImageInput(metadata.input_modalities) ??
    hasImageInput(model.input) ??
    hasImageInput(model.inputs) ??
    hasImageInput(model.modalities);
  const vision = explicitVision ?? inferVisionSupport(id);
  const explicitActive = metadata.active ?? model.active;

  return {
    id,
    name,
    provider: "vllm-studio",
    contextWindow,
    maxTokens,
    reasoning,
    vision,
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
    input: model.vision ? ["text", "image"] : ["text"],
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
