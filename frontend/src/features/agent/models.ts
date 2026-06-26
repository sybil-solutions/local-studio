import type { OpenAICompletionsCompat } from "@earendil-works/pi-ai";

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
  provider: "local-studio";
  providerId?: string;
  rawId?: string;
  controllerUrl?: string;
  controllerName?: string;
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
  const patterns = [
    "mimo-v2.5",
    "mimo-v2-5",
    "step-3.7",
    "step-3_7",
    "step-3-7",
    "nex-n2",
    "gemma-4",
    "gemma4",
    "llava",
    "internvl",
    "qwen-vl",
    "qwen2-vl",
    "qwen2.5-vl",
    "qwen3-vl",
    "qwen-omni",
    "pixtral",
    "minicpm-v",
    "molmo",
    "phi-3.5-v",
    "phi-3-vision",
    "phi-4-mm",
    "phi-4-multimodal",
    "llama-3.2-vision",
    "llama-4",
    "deepseek-vl",
    "idefics",
    "ovis",
    "moondream",
    "fuyu",
    "kosmos",
    "-vl-",
    "-vlm",
    "vision",
    "multimodal",
    "-mm-",
  ];
  return patterns.some((p) => normalized.includes(p));
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

function firstNumber(values: unknown[], fallback: number): number {
  for (const value of values) {
    const parsed = numberFromUnknown(value);
    if (parsed) return parsed;
  }
  return fallback;
}

function firstBoolean(values: unknown[]): boolean | undefined {
  for (const value of values) {
    const parsed = booleanFromUnknown(value);
    if (typeof parsed === "boolean") return parsed;
  }
  return undefined;
}

function firstImageInput(values: unknown[]): boolean | undefined {
  for (const value of values) {
    const parsed = hasImageInput(value);
    if (typeof parsed === "boolean") return parsed;
  }
  return undefined;
}

function resolveContextWindow(
  model: OpenAIModelListItem,
  metadata: Record<string, unknown>,
): number {
  return firstNumber(
    [
      model.contextWindow,
      model.context_window,
      model.max_model_len,
      metadata.contextWindow,
      metadata.context_window,
      metadata.max_model_len,
    ],
    128_000,
  );
}

function resolveMaxTokens(
  model: OpenAIModelListItem,
  metadata: Record<string, unknown>,
  contextWindow: number,
): number {
  return firstNumber(
    [model.maxTokens, model.max_tokens, metadata.maxTokens, metadata.max_tokens],
    Math.min(contextWindow, 65_536),
  );
}

function resolveReasoning(
  model: OpenAIModelListItem,
  metadata: Record<string, unknown>,
  id: string,
): boolean {
  const explicitReasoning = metadata.reasoning ?? model.reasoning;
  return typeof explicitReasoning === "boolean" ? explicitReasoning : inferReasoningSupport(id);
}

function resolveVision(
  model: OpenAIModelListItem,
  metadata: Record<string, unknown>,
  capabilities: Record<string, unknown>,
  id: string,
): boolean {
  const explicitVision =
    firstBoolean([
      metadata.vision,
      metadata.supportsVision,
      metadata.supports_vision,
      metadata.multimodal,
      capabilities.vision,
      capabilities.image,
    ]) ??
    firstImageInput([
      metadata.input,
      metadata.inputs,
      metadata.modalities,
      metadata.input_modalities,
      model.input,
      model.inputs,
      model.modalities,
    ]);
  return explicitVision ?? inferVisionSupport(id);
}

export function normalizeOpenAIModel(model: OpenAIModelListItem): AgentModel {
  const metadata = recordFromUnknown(model.metadata);
  const capabilities = recordFromUnknown(metadata.capabilities);
  const id = String(model.id || "").trim();
  const name = String(model.name || metadata.name || id).trim() || id;
  const contextWindow = resolveContextWindow(model, metadata);
  const maxTokens = resolveMaxTokens(model, metadata, contextWindow);
  const explicitActive = metadata.active ?? model.active;

  return {
    id,
    name,
    provider: "local-studio",
    contextWindow,
    maxTokens,
    reasoning: resolveReasoning(model, metadata, id),
    vision: resolveVision(model, metadata, capabilities, id),
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

function isDeepSeekReasoningModel(model: AgentModel): boolean {
  const id = `${model.id} ${model.rawId ?? ""} ${model.name}`.toLowerCase();
  return model.reasoning && id.includes("deepseek");
}

const VLLM_OPENAI_COMPAT: OpenAICompletionsCompat = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
  supportsStrictMode: false,
  supportsUsageInStreaming: true,
  maxTokensField: "max_tokens",
};

export function modelsToPiModels(models: AgentModel[]) {
  return models.map((model) => {
    const deepSeekReasoning = isDeepSeekReasoningModel(model);
    return {
      id: model.rawId ?? model.id,
      name: model.name,
      reasoning: model.reasoning,
      input: model.vision ? ["text", "image"] : ["text"],
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      ...(deepSeekReasoning
        ? {
            thinkingLevelMap: {
              off: null,
              minimal: null,
              low: "low",
              medium: "medium",
              high: "high",
              xhigh: "max",
            },
          }
        : {}),
      compat: {
        ...VLLM_OPENAI_COMPAT,
        ...(deepSeekReasoning
          ? {
              thinkingFormat: "deepseek",
              requiresReasoningContentOnAssistantMessages: true,
            }
          : {}),
      },
    };
  });
}
