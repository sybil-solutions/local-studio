import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { getApiSettings, type ApiSettings } from "./settings-service";
import { resolveDataDir } from "./data-dir";
import { listProviderAgentModels, refreshProviderHub } from "./provider-hub";
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
  active?: boolean;
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

/** Strip any prefixes this writer has already applied.
 *
 *  When PI_CODING_AGENT_DIR points at Local Studio's own data dir — which it
 *  does for the desktop app — the file we read here is the file we write. Every
 *  pass therefore re-prefixed providers that were already prefixed, so
 *  "vibeproxy-claude" became "user-pi-vibeproxy-claude", then
 *  "user-pi-user-pi-vibeproxy-claude", growing by one hop per launch. Observed
 *  in the wild at 26 nested hops and a 466 KB models.json.
 *
 *  Collapsing on read makes the merge idempotent and self-heals files that have
 *  already grown. */
function baseProviderName(name: string): string {
  let base = name;
  while (base.startsWith(USER_PI_PREFIX)) base = base.slice(USER_PI_PREFIX.length);
  return base;
}

async function loadUserPiProviders(): Promise<UserPiProviders> {
  const modelsPath = userPiModelsPath();
  if (!existsSync(modelsPath)) return {};
  try {
    const parsed = JSON.parse(await readFile(modelsPath, "utf-8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const providers = (parsed as { providers?: unknown }).providers;
    if (!providers || typeof providers !== "object" || Array.isArray(providers)) return {};
    const collapsed: UserPiProviders = {};
    for (const [name, config] of Object.entries(providers as UserPiProviders)) {
      const base = baseProviderName(name);
      // Our own controller providers are regenerated from the live controller
      // every pass; reading them back would duplicate them under a user-pi name
      // the moment the controller went away. Test the COLLAPSED name — a prior
      // pass has already produced "user-pi-local-studio" in the wild, which is
      // our own provider wearing a user-pi hat.
      if (!base || base === PROVIDER_ID || base.startsWith(`${PROVIDER_ID}-`)) continue;
      collapsed[base] = config;
    }
    return collapsed;
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

function controllerUrlIdentity(value: string): string {
  const normalized = normalizeBackendUrl(value);
  try {
    const parsed = new URL(normalized);
    const hostname = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname.toLowerCase())
      ? "loopback"
      : parsed.hostname.toLowerCase();
    const port =
      parsed.port || (parsed.protocol === "https:" ? "443" : parsed.protocol === "http:" ? "80" : "");
    const pathname = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.protocol}//${hostname}:${port}${pathname}`;
  } catch {
    return normalized;
  }
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

export function mergeControllers(
  settings: ApiSettings,
  requested: PiControllerModelsRequest[] = [],
): PiControllerConfig[] {
  const requestedController = requested
    .map(normalizeControllerInput)
    .find((controller): controller is PiControllerConfig => controller !== null);
  const primary = normalizeControllerInput({
    url: settings.backendUrl,
    apiKey: settings.apiKey,
    name: "primary",
  });
  if (requestedController) {
    if (
      !requestedController.apiKey &&
      primary?.apiKey &&
      controllerUrlIdentity(requestedController.url) === controllerUrlIdentity(primary.url)
    ) {
      return [{ ...requestedController, apiKey: primary.apiKey }];
    }
    return [requestedController];
  }
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
async function collectProviderAgentModels(): Promise<AgentModel[]> {
  await refreshProviderHub().catch(() => undefined);
  return listProviderAgentModels();
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
  maxTokensField: "max_completion_tokens",
};

export function modelsToPiModels(models: AgentModel[]) {
  return models.map((model) => {
    const deepSeekReasoning = isDeepSeekReasoningModel(model);
    return {
      id: model.rawId ?? model.id,
      name: model.name,
      active: model.active,
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
