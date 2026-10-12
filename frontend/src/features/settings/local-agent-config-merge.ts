/**
 * Merges a Local Studio model entry into each agent's own config shape,
 * mutating the parsed config in place so unrelated keys keep their original
 * order and any fields this feature doesn't know about survive untouched.
 */
import type { AttachAction, LocalAgentModel } from "./local-agent-types";
import { sameBaseUrl, type JsonRecord } from "./local-agent-config-file-io";
import { isRecord } from "@/lib/guards";

const DEFAULT_PROVIDER_KEY = "local-studio";

function providerKeyFor(taken: (key: string) => boolean): string {
  if (!taken(DEFAULT_PROVIDER_KEY)) return DEFAULT_PROVIDER_KEY;
  let suffix = 2;
  while (taken(`${DEFAULT_PROVIDER_KEY}-${suffix}`)) suffix += 1;
  return `${DEFAULT_PROVIDER_KEY}-${suffix}`;
}

const slugify = (value: string): string =>
  value.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export function mergePiConfig(config: JsonRecord, model: LocalAgentModel): AttachAction {
  if (!isRecord(config["providers"])) config["providers"] = {};
  const providers = config["providers"] as JsonRecord;

  const modelEntry: JsonRecord = {
    id: model.modelId,
    name: model.displayName,
    reasoning: model.reasoning,
    input: model.images ? ["text", "image"] : ["text"],
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: {},
  };

  const existing = Object.values(providers).find(
    (provider) => isRecord(provider) && sameBaseUrl(provider["baseUrl"], model.baseUrl),
  );
  if (isRecord(existing)) {
    if (!Array.isArray(existing["models"])) existing["models"] = [];
    const models = existing["models"] as unknown[];
    const index = models.findIndex((entry) => isRecord(entry) && entry["id"] === model.modelId);
    if (index >= 0) {
      models[index] = modelEntry;
      return "updated";
    }
    models.push(modelEntry);
    return "added";
  }

  const key = providerKeyFor((candidate) => candidate in providers);
  providers[key] = {
    baseUrl: model.baseUrl,
    apiKey: model.apiKey,
    api: "openai-completions",
    models: [modelEntry],
  };
  return "added";
}

export function providerKeyForBaseUrl(config: JsonRecord, baseUrl: string): string | null {
  const providers = config["providers"];
  if (!isRecord(providers)) return null;
  for (const [key, provider] of Object.entries(providers)) {
    if (isRecord(provider) && sameBaseUrl(provider["baseUrl"], baseUrl)) return key;
  }
  return null;
}

export function mergeOpencodeConfig(config: JsonRecord, model: LocalAgentModel): AttachAction {
  if (!isRecord(config["provider"])) config["provider"] = {};
  const providers = config["provider"] as JsonRecord;

  const modelEntry: JsonRecord = {
    id: model.modelId,
    name: model.displayName,
    limit: { context: model.contextWindow, output: model.maxTokens },
  };

  const existing = Object.values(providers).find((provider) => {
    if (!isRecord(provider)) return false;
    const options = provider["options"];
    return isRecord(options) && sameBaseUrl(options["baseURL"], model.baseUrl);
  });
  if (isRecord(existing)) {
    if (!isRecord(existing["models"])) existing["models"] = {};
    const models = existing["models"] as JsonRecord;
    const action: AttachAction = model.modelId in models ? "updated" : "added";
    models[model.modelId] = modelEntry;
    return action;
  }

  const key = providerKeyFor((candidate) => candidate in providers);
  providers[key] = {
    npm: "@ai-sdk/openai-compatible",
    name: "Local Studio",
    options: { baseURL: model.baseUrl, apiKey: model.apiKey },
    models: { [model.modelId]: modelEntry },
  };
  return "added";
}

export function mergeDroidConfig(config: JsonRecord, model: LocalAgentModel): AttachAction {
  if (!Array.isArray(config["customModels"])) config["customModels"] = [];
  const customModels = config["customModels"] as unknown[];

  const existing = customModels.find(
    (entry) =>
      isRecord(entry) &&
      entry["model"] === model.modelId &&
      sameBaseUrl(entry["baseUrl"], model.baseUrl),
  );
  if (isRecord(existing)) {
    existing["model"] = model.modelId;
    existing["baseUrl"] = model.baseUrl;
    existing["apiKey"] = model.apiKey;
    existing["displayName"] = model.displayName;
    existing["maxContextLimit"] = model.contextWindow;
    existing["noImageSupport"] = !model.images;
    existing["provider"] = "generic-chat-completion-api";
    return "updated";
  }

  const indexes = customModels
    .filter(isRecord)
    .map((entry) => entry["index"])
    .filter((value): value is number => typeof value === "number");
  const index = indexes.length > 0 ? Math.max(...indexes) + 1 : 0;
  customModels.push({
    model: model.modelId,
    id: `custom:${slugify(model.displayName)}-${index}`,
    index,
    baseUrl: model.baseUrl,
    apiKey: model.apiKey,
    displayName: model.displayName,
    maxContextLimit: model.contextWindow,
    noImageSupport: !model.images,
    provider: "generic-chat-completion-api",
  });
  return "added";
}

export function mergeHermesConfig(config: JsonRecord, model: LocalAgentModel): AttachAction {
  if (!Array.isArray(config["custom_models"])) config["custom_models"] = [];
  const customModels = config["custom_models"] as unknown[];

  const normaliseKey = (entry: unknown, key: "model" | "name") =>
    isRecord(entry) && typeof entry[key] === "string" ? entry[key] : "";

  const existing = customModels.find((entry) => {
    if (!isRecord(entry)) return false;
    const modelKey = normaliseKey(entry, "model");
    const nameKey = normaliseKey(entry, "name");
    return (
      (modelKey === model.modelId || nameKey === model.modelId) &&
      sameBaseUrl(entry["base_url"], model.baseUrl)
    );
  });
  if (isRecord(existing)) {
    existing["model"] = model.modelId;
    existing["name"] = model.displayName;
    existing["base_url"] = model.baseUrl;
    existing["api_key"] = model.apiKey;
    existing["provider"] = existing["provider"] ?? "custom";
    if (model.reasoning) existing["reasoning_effort"] = "high";
    return "updated";
  }

  const indexes = customModels
    .filter(isRecord)
    .map((entry) => entry["index"])
    .filter((value): value is number => typeof value === "number");
  const index = indexes.length > 0 ? Math.max(...indexes) + 1 : 0;
  const entry: JsonRecord = {
    name: model.displayName,
    model: model.modelId,
    base_url: model.baseUrl,
    api_key: model.apiKey,
    provider: "custom",
    index,
  };
  if (model.reasoning) entry["reasoning_effort"] = "high";
  customModels.push(entry);
  return "added";
}
