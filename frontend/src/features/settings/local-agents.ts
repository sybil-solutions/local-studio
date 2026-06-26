/**
 * Server-only support for attaching a Local Studio model to locally installed
 * coding-agent CLIs (pi, opencode, droid, hermes). Detection inspects well-known
 * config directories under a given home dir; attachment merges a provider /
 * model entry into each agent's own config file, preserving everything else
 * in the file and backing the file up before the first modification.
 */
import { chmod, copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import YAML from "yaml";

export type LocalAgentId = "pi" | "opencode" | "droid" | "hermes";

export const LOCAL_AGENT_IDS: readonly LocalAgentId[] = ["pi", "opencode", "droid", "hermes"];

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

export interface AttachResult {
  agent: LocalAgentId;
  ok: boolean;
  configPath: string;
  backupPath?: string;
  action?: AttachAction;
  error?: string;
}

type JsonRecord = Record<string, unknown>;

const DEFAULT_PROVIDER_KEY = "local-studio";

const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const normalizeBaseUrl = (url: string): string => url.trim().replace(/\/+$/, "");

const sameBaseUrl = (a: unknown, b: string): boolean =>
  typeof a === "string" && normalizeBaseUrl(a) === normalizeBaseUrl(b);

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(
  file: string,
): Promise<{ exists: boolean; config?: JsonRecord; error?: string }> {
  let raw: string;
  try {
    raw = await readFile(file, "utf-8");
  } catch {
    return { exists: false };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return { exists: true, error: `${file} does not contain a JSON object` };
    }
    return { exists: true, config: parsed };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { exists: true, error: `${file} is not valid JSON (${message}); refusing to modify it` };
  }
}

// --- per-agent config paths ---

const piConfigPath = (home: string): string => path.join(home, ".pi", "agent", "models.json");
const droidConfigPath = (home: string): string => path.join(home, ".factory", "settings.json");
const hermesConfigPath = (home: string): string => path.join(home, ".hermes", "config.yaml");

const opencodeCandidatePaths = (home: string): { xdg: string; dot: string } => ({
  xdg: path.join(home, ".config", "opencode", "opencode.json"),
  dot: path.join(home, ".opencode", "config.json"),
});

async function readYamlFile(
  file: string,
): Promise<{ exists: boolean; document?: YAML.Document; error?: string }> {
  let raw: string;
  try {
    raw = await readFile(file, "utf-8");
  } catch {
    return { exists: false };
  }
  try {
    const document = YAML.parseDocument(raw);
    return { exists: true, document };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { exists: true, error: `${file} is not valid YAML (${message}); refusing to modify it` };
  }
}

/**
 * Pick the opencode config file to write. Prefers an existing file whose
 * provider map already contains a matching-baseURL provider (when a baseUrl
 * is given), then `~/.config/opencode/opencode.json` when that directory
 * exists, then `~/.opencode/config.json`.
 */
async function resolveOpencodeConfigPath(home: string, baseUrl?: string): Promise<string> {
  const { xdg, dot } = opencodeCandidatePaths(home);
  if (baseUrl) {
    for (const candidate of [xdg, dot]) {
      const { config } = await readJsonFile(candidate);
      const providers = config?.["provider"];
      if (!isRecord(providers)) continue;
      const matches = Object.values(providers).some((provider) => {
        if (!isRecord(provider)) return false;
        const options = provider["options"];
        return isRecord(options) && sameBaseUrl(options["baseURL"], baseUrl);
      });
      if (matches) return candidate;
    }
  }
  if (await pathExists(xdg)) return xdg;
  if (await pathExists(dot)) return dot;
  if (await pathExists(path.join(home, ".config", "opencode"))) return xdg;
  return dot;
}

function resolveHermesConfigPath(home: string): string {
  return hermesConfigPath(home);
}

export async function detectLocalAgents(home: string): Promise<LocalAgentTarget[]> {
  const targets: LocalAgentTarget[] = [];

  if (await pathExists(path.join(home, ".pi"))) {
    const configPath = piConfigPath(home);
    targets.push({ agent: "pi", label: "pi", configPath, exists: await pathExists(configPath) });
  }

  const { xdg, dot } = opencodeCandidatePaths(home);
  if ((await pathExists(path.dirname(xdg))) || (await pathExists(path.dirname(dot)))) {
    const configPath = await resolveOpencodeConfigPath(home);
    targets.push({
      agent: "opencode",
      label: "opencode",
      configPath,
      exists: await pathExists(configPath),
    });
  }

  if (await pathExists(path.join(home, ".factory"))) {
    const configPath = droidConfigPath(home);
    targets.push({
      agent: "droid",
      label: "droid (Factory)",
      configPath,
      exists: await pathExists(configPath),
    });
  }

  if (await pathExists(path.join(home, ".hermes"))) {
    const configPath = hermesConfigPath(home);
    targets.push({
      agent: "hermes",
      label: "hermes",
      configPath,
      exists: await pathExists(configPath),
    });
  }

  return targets;
}

// --- merge rules (mutate the parsed config in place to preserve key order) ---

function providerKeyFor(taken: (key: string) => boolean): string {
  if (!taken(DEFAULT_PROVIDER_KEY)) return DEFAULT_PROVIDER_KEY;
  let suffix = 2;
  while (taken(`${DEFAULT_PROVIDER_KEY}-${suffix}`)) suffix += 1;
  return `${DEFAULT_PROVIDER_KEY}-${suffix}`;
}

function mergePiConfig(config: JsonRecord, model: LocalAgentModel): AttachAction {
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

function mergeOpencodeConfig(config: JsonRecord, model: LocalAgentModel): AttachAction {
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

const slugify = (value: string): string =>
  value.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");

function mergeDroidConfig(config: JsonRecord, model: LocalAgentModel): AttachAction {
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

function mergeHermesConfig(config: JsonRecord, model: LocalAgentModel): AttachAction {
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

// --- write behavior ---

function backupTimestamp(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

async function backupExistingFile(file: string): Promise<string> {
  const base = `${file}.bak-local-studio-${backupTimestamp(new Date())}`;
  let backupPath = base;
  let suffix = 2;
  while (await pathExists(backupPath)) {
    backupPath = `${base}-${suffix}`;
    suffix += 1;
  }
  await copyFile(file, backupPath);
  return backupPath;
}

async function writeJsonAtomic(file: string, config: JsonRecord, mode: number): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${randomBytes(6).toString("hex")}`;
  await writeFile(tmp, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf-8", mode });
  // writeFile's mode is subject to the process umask; chmod makes it exact.
  await chmod(tmp, mode);
  await rename(tmp, file);
}

async function writeYamlAtomic(file: string, config: JsonRecord, mode: number): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${randomBytes(6).toString("hex")}`;
  const yamlText = YAML.stringify(config, { indent: 2, lineWidth: 0 });
  await writeFile(tmp, yamlText, { encoding: "utf-8", mode });
  await chmod(tmp, mode);
  await rename(tmp, file);
}

async function existingFileMode(file: string): Promise<number | null> {
  try {
    return (await stat(file)).mode & 0o777;
  } catch {
    return null;
  }
}

interface AgentAttachPlan {
  configPath: string;
  detected: boolean;
  format: "json" | "yaml";
  /** Object to start from when the config file does not exist yet. */
  emptyConfig: () => JsonRecord;
  merge: (config: JsonRecord, model: LocalAgentModel) => AttachAction;
}

async function planFor(
  agent: LocalAgentId,
  home: string,
  model: LocalAgentModel,
): Promise<AgentAttachPlan> {
  if (agent === "pi") {
    return {
      configPath: piConfigPath(home),
      detected: await pathExists(path.join(home, ".pi")),
      format: "json",
      emptyConfig: () => ({ providers: {} }),
      merge: mergePiConfig,
    };
  }
  if (agent === "opencode") {
    const { xdg, dot } = opencodeCandidatePaths(home);
    const detected = (await pathExists(path.dirname(xdg))) || (await pathExists(path.dirname(dot)));
    return {
      configPath: await resolveOpencodeConfigPath(home, model.baseUrl),
      detected,
      format: "json",
      emptyConfig: () => ({ $schema: "https://opencode.ai/config.json" }),
      merge: mergeOpencodeConfig,
    };
  }
  if (agent === "hermes") {
    return {
      configPath: hermesConfigPath(home),
      detected: await pathExists(path.join(home, ".hermes")),
      format: "yaml",
      emptyConfig: () => ({ custom_models: [] }),
      merge: mergeHermesConfig,
    };
  }
  return {
    configPath: droidConfigPath(home),
    detected: await pathExists(path.join(home, ".factory")),
    format: "json",
    emptyConfig: () => ({ customModels: [] }),
    merge: mergeDroidConfig,
  };
}

async function attachToAgent(
  agent: LocalAgentId,
  home: string,
  model: LocalAgentModel,
): Promise<AttachResult> {
  const plan = await planFor(agent, home, model);
  const { configPath, format } = plan;
  if (!plan.detected) {
    return {
      agent,
      ok: false,
      configPath,
      error: `${agent} is not installed (config directory not found)`,
    };
  }

  let file: { exists: boolean; config?: JsonRecord; error?: string };
  if (format === "yaml") {
    const yamlFile = await readYamlFile(configPath);
    if (yamlFile.error) {
      return { agent, ok: false, configPath, error: yamlFile.error };
    }
    file = { exists: yamlFile.exists, config: yamlFile.document?.toJS() as JsonRecord | undefined };
  } else {
    file = await readJsonFile(configPath);
  }
  if (file.error) {
    return { agent, ok: false, configPath, error: file.error };
  }

  const config = file.config ?? plan.emptyConfig();
  const mergeAction = plan.merge(config, model);

  let backupPath: string | undefined;
  if (file.exists) {
    backupPath = await backupExistingFile(configPath);
  }

  const mode = file.exists ? ((await existingFileMode(configPath)) ?? 0o600) : 0o600;
  if (format === "yaml") {
    await writeYamlAtomic(configPath, config, mode);
  } else {
    await writeJsonAtomic(configPath, config, mode);
  }

  const action: AttachAction = file.exists ? mergeAction : "created-file";
  return { agent, ok: true, configPath, backupPath, action };
}

export async function attachModelToAgents(input: AttachModelInput): Promise<AttachResult[]> {
  const results: AttachResult[] = [];
  for (const agent of input.targets) {
    try {
      results.push(await attachToAgent(agent, input.home, input.model));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const plan = await planFor(agent, input.home, input.model).catch(() => null);
      results.push({
        agent,
        ok: false,
        configPath: plan?.configPath ?? "",
        error: message,
      });
    }
  }
  return results;
}
