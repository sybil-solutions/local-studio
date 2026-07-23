import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { getApiSettings, type ApiSettings } from "./settings-service";
import { resolveDataDir } from "./data-dir";
import { isAgentRuntimeProcess, listProviderAgentModels, reloadProviderHub } from "./provider-hub";
import type { OpenAICompletionsCompat } from "@earendil-works/pi-ai";
import {
  normalizeOpenAIModels,
  inferReasoningSupport,
  type AgentModel,
} from "../../../shared/agent/models";
import { AGENT_THINKING_LEVELS, type AgentThinkingLevel } from "../../../shared/agent/agent-turn";
import { resolveModelVision } from "../../../controller/contracts/model-capabilities";

const PROVIDER_ID = "local-studio";
const USER_PI_PREFIX = "user-pi-";

function userPiModelsPath(): string {
  const agentDir = process.env["PI_CODING_AGENT_DIR"]?.trim();
  return path.join(
    agentDir || path.join(process.env["HOME"] ?? homedir(), ".pi", "agent"),
    "models.json",
  );
}

type PiProviderModel = {
  id: string;
  name?: string;
  reasoning?: boolean;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: Record<string, number>;
  compat?: Record<string, unknown>;
  thinkingLevelMap?: Partial<Record<AgentThinkingLevel, string | null>>;
};

type PiProviderConfig = {
  baseUrl: string;
  apiKey?: string;
  api?: string;
  authHeader?: boolean;
  models?: PiProviderModel[];
  compat?: Record<string, unknown>;
};

type UserPiProviders = Record<string, PiProviderConfig>;

async function loadUserPiProviders(): Promise<UserPiProviders> {
  const modelsPath = userPiModelsPath();
  if (!existsSync(modelsPath)) return {};
  try {
    const parsed = JSON.parse(await readFile(modelsPath, "utf-8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const providers = (parsed as { providers?: unknown }).providers;
    if (!providers || typeof providers !== "object" || Array.isArray(providers)) return {};
    return providers as UserPiProviders;
  } catch {
    return {};
  }
}

function userPiModelToAgentModel(
  providerName: string,
  qualifiedProviderId: string,
  model: PiProviderModel,
  providerCompat?: Record<string, unknown>,
): AgentModel {
  const rawId = model.id;
  const name = model.name ?? rawId;
  const inputs = model.input ?? ["text"];
  const reasoning = model.reasoning ?? inferReasoningSupport(rawId);
  return {
    id: `${qualifiedProviderId}/${rawId}`,
    rawId,
    name: `${name} · ${providerName}`,
    provider: "local-studio",
    providerId: qualifiedProviderId,
    controllerName: providerName,
    contextWindow: model.contextWindow ?? 128_000,
    maxTokens: model.maxTokens ?? 65_536,
    reasoning,
    thinkingLevels: supportedPiThinkingLevels(model, reasoning, providerCompat),
    vision: resolveModelVision({ identifiers: [rawId], modalities: [inputs] }),
    active: false,
  };
}

function supportedPiThinkingLevels(
  model: PiProviderModel,
  reasoning: boolean,
  providerCompat?: Record<string, unknown>,
): AgentThinkingLevel[] {
  if (!reasoning) return ["off"];
  const supportsReasoningEffort =
    model.compat?.supportsReasoningEffort ?? providerCompat?.supportsReasoningEffort;
  if (supportsReasoningEffort !== true) return ["high"];
  return AGENT_THINKING_LEVELS.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level];
    if (mapped === null) return false;
    if (level === "xhigh" || level === "max") return mapped !== undefined;
    return true;
  });
}

export function controllerModelThinkingLevels(reasoning: boolean): AgentThinkingLevel[] {
  return AGENT_THINKING_LEVELS.filter((level) =>
    reasoning ? level === "high" || level === "max" : level === "off",
  );
}

export type PiControllerModelsRequest = {
  url: string;
  apiKey?: string;
  name?: string;
};

type PiControllerConfig = {
  url: string;
  apiKey: string;
  name?: string;
};

type ControllerModels = {
  controller: PiControllerConfig;
  models: AgentModel[];
  providerId: string;
};

function controllersPath(agentDir: string): string {
  return path.join(agentDir, "controllers.json");
}

function controllerLabel(controller: PiControllerConfig, index: number): string {
  if (controller.name?.trim()) return controller.name.trim();
  try {
    return new URL(controller.url).host;
  } catch {
    return index === 0 ? "primary" : `controller ${index + 1}`;
  }
}

function providerIdForController(controller: PiControllerConfig, index: number): string {
  if (index === 0) return PROVIDER_ID;
  const normalized = controller.url
    .replace(/^https?:\/\//i, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `${PROVIDER_ID}-${normalized || index + 1}`;
}

function qualifyModelId(providerId: string, rawId: string): string {
  return providerId === PROVIDER_ID ? rawId : `${providerId}/${rawId}`;
}

function normalizeBackendUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function normalizeControllerInput(input: PiControllerModelsRequest): PiControllerConfig | null {
  const url = normalizeBackendUrl(input.url || "");
  if (!url) return null;
  const apiKey = input.apiKey?.trim() ?? "";
  const name = input.name?.trim();
  return {
    url,
    apiKey,
    ...(name ? { name } : {}),
  };
}

function mergeControllers(
  settings: ApiSettings,
  requested: PiControllerModelsRequest[] = [],
): PiControllerConfig[] {
  const requestedController = requested
    .map(normalizeControllerInput)
    .find((controller): controller is PiControllerConfig => controller !== null);
  if (requestedController) return [requestedController];
  const primary = normalizeControllerInput({
    url: settings.backendUrl,
    apiKey: settings.apiKey,
    name: "primary",
  });
  return primary ? [primary] : [];
}

async function loadPersistedControllers(agentDir: string): Promise<PiControllerModelsRequest[]> {
  const file = controllersPath(agentDir);
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(await readFile(file, "utf-8")) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is PiControllerModelsRequest =>
        Boolean(entry && typeof entry === "object" && !Array.isArray(entry)),
      )
      .flatMap((entry) => {
        const record = entry as Record<string, unknown>;
        return typeof record.url === "string"
          ? [
              {
                url: record.url,
                ...(typeof record.apiKey === "string" ? { apiKey: record.apiKey } : {}),
                ...(typeof record.name === "string" ? { name: record.name } : {}),
              },
            ]
          : [];
      });
  } catch {
    return [];
  }
}

async function savePersistedControllers(
  agentDir: string,
  controllers: PiControllerConfig[],
): Promise<void> {
  await writeFile(controllersPath(agentDir), JSON.stringify(controllers, null, 2), "utf-8");
  await chmod(controllersPath(agentDir), 0o600).catch(() => undefined);
}

async function fetchModelsFromController(
  controller: PiControllerConfig,
  index: number,
  multipleControllers: boolean,
): Promise<ControllerModels> {
  const backendUrl = normalizeBackendUrl(controller.url);
  const headers: HeadersInit = { Accept: "application/json" };
  if (controller.apiKey) headers.Authorization = `Bearer ${controller.apiKey}`;
  const response = await fetch(`${backendUrl}/v1/models`, { headers, cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${backendUrl}/v1/models failed with HTTP ${response.status}`);
  }
  const payload = (await response.json()) as unknown;
  const providerId = providerIdForController(controller, index);
  const label = controllerLabel(controller, index);
  const models = normalizeOpenAIModels(payload && typeof payload === "object" ? payload : {}).map(
    (model) => ({
      ...model,
      reasoning: model.reasoning,
      id: qualifyModelId(providerId, model.id),
      rawId: model.id,
      providerId,
      controllerUrl: backendUrl,
      controllerName: label,
      thinkingLevels: controllerModelThinkingLevels(model.reasoning),
      name: multipleControllers ? `${model.name} · ${label}` : model.name,
    }),
  );
  return { controller: { ...controller, url: backendUrl }, models, providerId };
}

async function fetchModelsFromControllers(controllers: PiControllerConfig[]): Promise<{
  models: AgentModel[];
  controllerModels: ControllerModels[];
}> {
  const settled = await Promise.allSettled(
    controllers.map((controller, index) =>
      fetchModelsFromController(controller, index, controllers.length > 1),
    ),
  );
  const controllerModels = settled
    .filter(
      (result): result is PromiseFulfilledResult<ControllerModels> => result.status === "fulfilled",
    )
    .map((result) => result.value);
  if (controllerModels.length === 0) {
    const firstError = settled.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    throw firstError?.reason instanceof Error
      ? firstError.reason
      : new Error("No controllers returned models.");
  }
  const seen = new Set<string>();
  const models: AgentModel[] = [];
  for (const result of controllerModels) {
    for (const model of result.models) {
      if (seen.has(model.id)) continue;
      seen.add(model.id);
      models.push(model);
    }
  }
  return { models: models.sort((a, b) => a.name.localeCompare(b.name)), controllerModels };
}

async function writePiModelsConfig(
  controllerModels: ControllerModels[],
  userPiProviders: UserPiProviders,
): Promise<string> {
  const dataDir = resolveDataDir();
  const agentDir = path.join(dataDir, "pi-agent");
  await mkdir(agentDir, { recursive: true });
  await chmod(agentDir, 0o700).catch(() => undefined);

  const vllmProviders = Object.fromEntries(
    controllerModels.map(({ controller, models, providerId }) => [
      providerId,
      {
        baseUrl: `${controller.url}/v1`,
        api: "openai-completions",
        apiKey: controller.apiKey || "local-studio",
        authHeader: Boolean(controller.apiKey),
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: true,
        },
        models: modelsToPiModels(models),
      },
    ]),
  );

  const providers: Record<string, unknown> = { ...vllmProviders };
  for (const [name, config] of Object.entries(userPiProviders)) {
    providers[`${USER_PI_PREFIX}${name}`] = {
      baseUrl: config.baseUrl,
      ...(config.apiKey ? { apiKey: config.apiKey } : {}),
      ...(config.api ? { api: config.api } : {}),
      ...(config.authHeader !== undefined ? { authHeader: config.authHeader } : {}),
      ...(config.compat ? { compat: config.compat } : {}),
      models: config.models ?? [],
    };
  }

  const modelsPath = path.join(agentDir, "models.json");
  await writeFile(modelsPath, JSON.stringify({ providers }, null, 2), "utf-8");
  await chmod(modelsPath, 0o600).catch(() => undefined);
  return agentDir;
}

export function resolvePiModelSelection(modelId: string): { providerId: string; modelId: string } {
  const separator = modelId.indexOf("/");
  if (separator > 0) {
    const maybeProvider = modelId.slice(0, separator);
    if (maybeProvider.startsWith(USER_PI_PREFIX) || maybeProvider.startsWith(`${PROVIDER_ID}-`)) {
      return { providerId: maybeProvider, modelId: modelId.slice(separator + 1) };
    }
  }
  return { providerId: PROVIDER_ID, modelId };
}

export async function refreshPiModels(
  requestedControllers?: PiControllerModelsRequest[],
): Promise<{ models: AgentModel[]; agentDir: string }> {
  const settings = await getApiSettings();
  const dataDir = resolveDataDir();
  const agentDir = path.join(dataDir, "pi-agent");
  await mkdir(agentDir, { recursive: true });
  await chmod(agentDir, 0o700).catch(() => undefined);
  const persisted =
    requestedControllers && requestedControllers.length > 0
      ? requestedControllers
      : await loadPersistedControllers(agentDir);
  const controllers = mergeControllers(settings, persisted);
  await savePersistedControllers(agentDir, controllers);
  // A dead controller must not hide signed-in cloud providers: collect the
  // failure and only surface it when nothing else can serve models.
  let models: AgentModel[] = [];
  let controllerModels: ControllerModels[] = [];
  let controllerError: unknown = null;
  try {
    ({ models, controllerModels } = await fetchModelsFromControllers(controllers));
  } catch (error) {
    controllerError = error;
  }

  const userPiProviders = await loadUserPiProviders();
  const userPiModels = Object.entries(userPiProviders).flatMap(([providerName, config]) => {
    const qualifiedProviderId = `${USER_PI_PREFIX}${providerName}`;
    return (config.models ?? []).map((model) =>
      userPiModelToAgentModel(providerName, qualifiedProviderId, model, config.compat),
    );
  });
  const writtenAgentDir = await writePiModelsConfig(controllerModels, userPiProviders);
  const providerModels = await collectProviderAgentModels();

  const allModels = [...models, ...userPiModels, ...providerModels];
  if (allModels.length === 0 && controllerError) {
    throw controllerError instanceof Error
      ? controllerError
      : new Error("No controllers returned models.");
  }
  return { models: allModels, agentDir: writtenAgentDir };
}
// The agent-runtime process owns the provider hub (one pi ModelRuntime for
// sessions and sign-in). When this module runs inside the Next server it must
// not instantiate a second runtime — pi internals don't survive the Next
// bundler and credentials/composition would diverge — so it asks the agent
// runtime over HTTP instead. Models.json was just rewritten either way; the
// hub re-reads it before listing (locally here, in the handler over HTTP).
async function collectProviderAgentModels(): Promise<AgentModel[]> {
  if (isAgentRuntimeProcess()) {
    await reloadProviderHub().catch(() => undefined);
    return listProviderAgentModels();
  }
  const base = (process.env.LOCAL_STUDIO_AGENT_RUNTIME_URL || "http://127.0.0.1:8081").replace(
    /\/+$/,
    "",
  );
  try {
    const response = await fetch(`${base}/api/agent/providers/models`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as { models?: AgentModel[] };
    return Array.isArray(payload.models) ? payload.models : [];
  } catch {
    return [];
  }
}

// Moved here from the shared models module: only the runtime needs the
// pi-model mapping, and the OpenAICompletionsCompat type must resolve against
// the SDK install.
function isDeepSeekReasoningModel(model: AgentModel): boolean {
  const id = `${model.id} ${model.rawId ?? ""} ${model.name}`.toLowerCase();
  return model.reasoning && id.includes("deepseek");
}

const VLLM_OPENAI_COMPAT: OpenAICompletionsCompat = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: true,
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
              max: "max",
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
