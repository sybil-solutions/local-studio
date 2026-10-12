/**
 * Locates each supported coding agent's config directory/file under a given
 * home dir, so callers can tell which agents are actually installed before
 * offering to attach a model to them.
 */
import path from "node:path";
import type { LocalAgentTarget } from "./local-agent-types";
import { pathExists, readJsonFile, sameBaseUrl } from "./local-agent-config-file-io";
import { isRecord } from "@/lib/guards";

export const piConfigPath = (home: string): string =>
  path.join(home, ".pi", "agent", "models.json");
export const droidConfigPath = (home: string): string =>
  path.join(home, ".factory", "settings.json");
export const hermesConfigPath = (home: string): string => path.join(home, ".hermes", "config.yaml");
export const ompSettingsPath = (home: string): string =>
  path.join(home, ".omp", "agent", "config.yml");

export const ompConfigCandidatePaths = (home: string): { yml: string; json: string } => ({
  yml: path.join(home, ".omp", "agent", "models.yml"),
  json: path.join(home, ".omp", "agent", "models.json"),
});

export async function resolveOmpConfigPath(home: string): Promise<string> {
  const { yml, json } = ompConfigCandidatePaths(home);
  if (await pathExists(yml)) return yml;
  if (await pathExists(json)) return json;
  return yml;
}

export const opencodeCandidatePaths = (home: string): { xdg: string; dot: string } => ({
  xdg: path.join(home, ".config", "opencode", "opencode.json"),
  dot: path.join(home, ".opencode", "config.json"),
});

/**
 * Pick the opencode config file to write. Prefers an existing file whose
 * provider map already contains a matching-baseURL provider (when a baseUrl
 * is given), then `~/.config/opencode/opencode.json` when that directory
 * exists, then `~/.opencode/config.json`.
 */
export async function resolveOpencodeConfigPath(home: string, baseUrl?: string): Promise<string> {
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
      label: "Hermes",
      configPath,
      exists: await pathExists(configPath),
    });
  }

  if (await pathExists(path.join(home, ".omp"))) {
    const configPath = await resolveOmpConfigPath(home);
    targets.push({
      agent: "omp",
      label: "omp (Oh My Pi)",
      configPath,
      exists: await pathExists(configPath),
    });
  }

  return targets;
}
