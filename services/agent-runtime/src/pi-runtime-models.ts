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
    if (level === "auto") return model.thinkingLevelMap?.minimal === "auto";
    const mapped = model.thinkingLevelMap?.[level];
    if (mapped === null) return false;
    if (level === "xhigh" || level === "max") return mapped !== undefined;
    return true;
  });
}

function isInklingModelId(modelId: string): boolean {
  return modelId.toLowerCase().includes("inkling");
}

export function controllerModelThinkingLevels(
  reasoning: boolean,
  modelId = "",
): AgentThinkingLevel[] {
  if (reasoning && isInklingModelId(modelId)) {
    return ["off", "minimal", "low", "medium", "high", "max"];
  }
  return reasoning ? ["auto", "low", "medium", "high", "max", "off"] : ["off"];
}

export function toPiThinkingLevel(level: AgentThinkingLevel): Exclude<AgentThinkingLevel, "auto"> {
  return level === "auto" ? "minimal" : level;
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
    const rawHostname = parsed.hostname.toLowerCase().replace(/\.+$/, "");
    const hostname = ["localhost", "127.0.0.1", "[::1]"].includes(rawHostname)
      ? "loopback"
      : rawHostname;
    const port =
      parsed.port ||
      (parsed.protocol === "https:" ? "443" : parsed.protocol === "http:" ? "80" : "");
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

function mergeControllers(
  settings: ApiSettings,
  requested: PiControllerModelsRequest[] = [],
): PiControllerConfig[] {
  const primary = normalizeControllerInput({
    url: settings.backendUrl,
    apiKey: settings.apiKey,
    name: "primary",
  });
  const requestedControllers = requested
    .map(normalizeControllerInput)
    .filter((controller): controller is PiControllerConfig => controller !== null);
  if (requestedControllers.length > 0) {
    // A request that names the primary without its key means "that one", not
    // "that one, unauthenticated" — backfill the saved credential (compared
    // by URL identity, so localhost and 127.0.0.1 are the same controller)
    // so a keyless mention can't silently disconnect a controller that needs
    // auth.
    const merged = requestedControllers.map((controller) =>
      !controller.apiKey &&
      primary?.apiKey &&
      controllerUrlIdentity(controller.url) === controllerUrlIdentity(primary.url)
        ? { ...controller, apiKey: primary.apiKey }
        : controller,
    );
    return [...new Map(merged.map((controller) => [controller.url, controller])).values()];
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
  controllers: PiControllerModelsRequest[],
): Promise<void> {
  const normalized = controllers
    .map(normalizeControllerInput)
    .filter((controller): controller is PiControllerConfig => controller !== null);
  const unique = [
    ...new Map(normalized.map((controller) => [controller.url, controller])).values(),
  ];
  await writeFile(controllersPath(agentDir), JSON.stringify(unique, null, 2), "utf-8");
  await chmod(controllersPath(agentDir), 0o600).catch(() => undefined);
}

/** How long a single controller gets to answer /v1/models before it is
 *  treated as down. A healthy tailnet peer answers in well under 150ms
 *  (measured 21-82ms), so 2.5s is already generous headroom for a slow LAN or
 *  a controller busy loading a model. */
const CONTROLLER_MODELS_TIMEOUT_MS = 2_500;

/** How long a controller that timed out or refused a connection is skipped
 *  before it is probed again. Within this window it is served as an empty
 *  model list immediately, so one dead saved controller cannot make every
 *  /api/agent/models call pay the full connect timeout (measured: a 4s flat
 *  median on the desktop app while a saved peer was off). */
const CONTROLLER_UNREACHABLE_BACKOFF_MS = 60_000;

/** In-memory negative cache of unreachable controllers, keyed by normalized
 *  controller URL identity. A successful fetch (or any HTTP response at all —
 *  even an error status proves the host is reachable) clears the entry. */
const unreachableControllers = new Map<string, { failedAt: number }>();

function isControllerBackedOff(identity: string): boolean {
  const entry = unreachableControllers.get(identity);
  if (!entry) return false;
  if (Date.now() - entry.failedAt >= CONTROLLER_UNREACHABLE_BACKOFF_MS) {
    unreachableControllers.delete(identity);
    return false;
  }
  return true;
}

async function fetchModelsFromController(
  controller: PiControllerConfig,
  index: number,
  multipleControllers: boolean,
): Promise<ControllerModels> {
  const backendUrl = normalizeBackendUrl(controller.url);
  const identity = controllerUrlIdentity(backendUrl);
  if (isControllerBackedOff(identity)) {
    // Recently unreachable: answer instantly with no models rather than
    // paying the connect timeout again. The entry expires after the backoff
    // window, so a controller that comes back is picked up within a minute.
    return {
      controller: { ...controller, url: backendUrl },
      models: [],
      providerId: providerIdForController(controller, index),
    };
  }
  const headers: HeadersInit = { Accept: "application/json" };
  if (controller.apiKey) headers.Authorization = `Bearer ${controller.apiKey}`;
  let response: Response;
  try {
    response = await fetch(`${backendUrl}/v1/models`, {
      headers,
      cache: "no-store",
      // Every saved controller is listed before the composer can show a single
      // model, and Promise.allSettled below waits for all of them. Without a
      // deadline one unreachable host holds the whole model picker hostage for
      // however long its network stack takes to give up — measured at 10.5s for
      // a tailnet peer that is simply off. A controller slower than the
      // deadline is reported as failed and the rest of the list still loads.
      signal: AbortSignal.timeout(CONTROLLER_MODELS_TIMEOUT_MS),
    });
  } catch (error) {
    // Timed out or refused: remember it so the next calls skip this host.
    unreachableControllers.set(identity, { failedAt: Date.now() });
    throw error;
  }
  unreachableControllers.delete(identity);
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
      thinkingLevels: controllerModelThinkingLevels(model.reasoning, model.rawId ?? model.id),
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
  await savePersistedControllers(agentDir, persisted);
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

function isDeepSeekReasoningModel(model: AgentModel): boolean {
  const id = `${model.id} ${model.rawId ?? ""} ${model.name}`.toLowerCase();
  return model.reasoning && id.includes("deepseek");
}

function isControllerBackedModel(model: AgentModel): boolean {
  return typeof model.controllerUrl === "string" && model.controllerUrl.length > 0;
}

function isInklingReasoningModel(model: AgentModel): boolean {
  const id = `${model.id} ${model.rawId ?? ""} ${model.name}`.toLowerCase();
  return model.reasoning && id.includes("inkling");
}

const VLLM_OPENAI_COMPAT: OpenAICompletionsCompat = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: true,
  supportsStrictMode: false,
  supportsUsageInStreaming: true,
  maxTokensField: "max_completion_tokens",
};

const CONTROLLER_THINKING_LEVEL_MAP = {
  off: "off",
  minimal: "auto",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "max",
  max: "max",
} as const;

export function modelsToPiModels(models: AgentModel[]) {
  return models.map((model) => {
    const deepSeekReasoning = isDeepSeekReasoningModel(model) && !isControllerBackedModel(model);
    const inklingReasoning = isInklingReasoningModel(model);
    return {
      id: model.rawId ?? model.id,
      name: model.name,
      active: model.active,
      reasoning: model.reasoning,
      input: model.vision ? ["text", "image"] : ["text"],
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      ...(model.controllerUrl && model.reasoning
        ? { thinkingLevelMap: CONTROLLER_THINKING_LEVEL_MAP }
        : deepSeekReasoning
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
          : inklingReasoning
            ? {
                thinkingLevelMap: {
                  off: "none",
                  minimal: "minimal",
                  low: "low",
                  medium: "medium",
                  high: "high",
                  xhigh: null,
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
