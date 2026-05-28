import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { getApiSettings, type ApiSettings } from "@/lib/api-settings";
import { resolveDataDir } from "@/lib/data-dir";
import { normalizeOpenAIModels, modelsToPiModels, type AgentModel } from "./models";

const PROVIDER_ID = "vllm-studio";

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
  const byUrl = new Map<string, PiControllerConfig>();
  const primary = normalizeControllerInput({
    url: settings.backendUrl,
    apiKey: settings.apiKey,
    name: "primary",
  });
  if (primary) byUrl.set(primary.url, primary);
  for (const entry of requested) {
    const controller = normalizeControllerInput(entry);
    if (!controller) continue;
    const existing = byUrl.get(controller.url);
    byUrl.set(controller.url, {
      ...existing,
      ...controller,
      apiKey: controller.apiKey || existing?.apiKey || "",
    });
  }
  return [...byUrl.values()];
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
      id: qualifyModelId(providerId, model.id),
      rawId: model.id,
      providerId,
      controllerUrl: backendUrl,
      controllerName: label,
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

async function writePiModelsConfig(controllerModels: ControllerModels[]): Promise<string> {
  const dataDir = resolveDataDir();
  const agentDir = path.join(dataDir, "pi-agent");
  await mkdir(agentDir, { recursive: true });
  await chmod(agentDir, 0o700).catch(() => undefined);

  const config = {
    providers: Object.fromEntries(
      controllerModels.map(({ controller, models, providerId }) => [
        providerId,
        {
          baseUrl: `${controller.url}/v1`,
          api: "openai-completions",
          apiKey: controller.apiKey || "vllm-studio",
          authHeader: Boolean(controller.apiKey),
          compat: {
            supportsDeveloperRole: false,
            supportsReasoningEffort: false,
          },
          models: modelsToPiModels(models),
        },
      ]),
    ),
  };

  const modelsPath = path.join(agentDir, "models.json");
  await writeFile(modelsPath, JSON.stringify(config, null, 2), "utf-8");
  await chmod(modelsPath, 0o600).catch(() => undefined);
  return agentDir;
}

export function resolvePiModelSelection(modelId: string): { providerId: string; modelId: string } {
  const separator = modelId.indexOf("/");
  if (separator > 0) {
    const maybeProvider = modelId.slice(0, separator);
    if (maybeProvider.startsWith(`${PROVIDER_ID}-`)) {
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
  const { models, controllerModels } = await fetchModelsFromControllers(controllers);
  const writtenAgentDir = await writePiModelsConfig(controllerModels);
  return { models, agentDir: writtenAgentDir };
}
