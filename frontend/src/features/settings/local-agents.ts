/**
 * Server-only support for attaching a Local Studio model to locally installed
 * coding-agent CLIs (pi, opencode, droid, hermes). Detection inspects well-known
 * config directories under a given home dir; attachment merges a provider /
 * model entry into each agent's own config file, preserving everything else
 * in the file and backing the file up before the first modification.
 */
import path from "node:path";
import { isRecord } from "@/lib/guards";
import {
  backupExistingFile,
  existingFileMode,
  pathExists,
  readJsonFile,
  readYamlFile,
  writeJsonAtomic,
  writeYamlAtomic,
  type JsonRecord,
} from "./local-agent-config-file-io";
import {
  mergeDroidConfig,
  mergeHermesConfig,
  mergeOpencodeConfig,
  mergePiConfig,
  providerKeyForBaseUrl,
} from "./local-agent-config-merge";
import {
  detectLocalAgents,
  droidConfigPath,
  hermesConfigPath,
  ompSettingsPath,
  opencodeCandidatePaths,
  piConfigPath,
  resolveOmpConfigPath,
  resolveOpencodeConfigPath,
} from "./local-agent-detection";
import type {
  AttachAction,
  AttachExtraUpdate,
  AttachModelInput,
  AttachResult,
  LocalAgentId,
  LocalAgentModel,
} from "./local-agent-types";

export { LOCAL_AGENT_IDS, type LocalAgentId, type LocalAgentTarget } from "./local-agent-types";
export type { AttachAction, AttachModelInput, AttachResult, LocalAgentModel };
export { detectLocalAgents };

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
  if (agent === "omp") {
    const configPath = await resolveOmpConfigPath(home);
    return {
      configPath,
      detected: await pathExists(path.join(home, ".omp")),
      format: configPath.endsWith(".json") ? "json" : "yaml",
      emptyConfig: () => ({ providers: {} }),
      merge: mergePiConfig,
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
  const extraUpdates =
    agent === "omp" ? await enableOmpModel(home, model, config).catch(() => undefined) : undefined;
  return {
    agent,
    ok: true,
    configPath,
    backupPath,
    action,
    ...(extraUpdates ? { extraUpdates } : {}),
  };
}

async function enableOmpModel(
  home: string,
  model: LocalAgentModel,
  mergedConfig: JsonRecord,
): Promise<AttachExtraUpdate[] | undefined> {
  const providerKey = providerKeyForBaseUrl(mergedConfig, model.baseUrl);
  if (!providerKey) return undefined;
  const settingsPath = ompSettingsPath(home);
  const settings = await readYamlFile(settingsPath);
  if (settings.error || !settings.exists || !settings.document) return undefined;
  const doc = settings.document.toJS() as JsonRecord | undefined;
  if (!isRecord(doc)) return undefined;
  const enabled = doc["enabledModels"];
  if (!Array.isArray(enabled) || enabled.length === 0) return undefined;
  const selector = `${providerKey}/${model.modelId}`;
  if (enabled.includes(selector)) return undefined;
  enabled.push(selector);
  const backupPath = await backupExistingFile(settingsPath);
  const mode = (await existingFileMode(settingsPath)) ?? 0o600;
  await writeYamlAtomic(settingsPath, doc, mode);
  return [{ configPath: settingsPath, backupPath }];
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
