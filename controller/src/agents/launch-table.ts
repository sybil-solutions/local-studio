import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BuiltLaunch, Client, Harness } from "@local-studio/contracts";
import { HARNESS_CLIENT } from "@local-studio/contracts";
import { readSecret } from "./keys";

export type TerminalHarness = "claude" | "codex" | "pi" | "omp" | "hermes" | "droid";
export const isTerminal = (h: Harness): h is TerminalHarness => ["claude", "codex", "pi", "omp", "hermes", "droid"].includes(h);
export const clientOf = (h: Harness): Client => HARNESS_CLIENT[h];

export interface LaunchInput {
  harness: Harness;
  home: string;
  model: string;
  contextWindow: number | null;
  vision: boolean | null;
  dir: string;
  keyFile: string;
  gatewayUrl: string;
  sessionId: string;
  safe: boolean;
}

export const YOLO: Partial<Record<Harness, string>> = {
  claude: "--dangerously-skip-permissions",
  codex: "--dangerously-bypass-approvals-and-sandbox",
  hermes: "--yolo",
};

export const ENV_UNSET: Partial<Record<Harness, string[]>> = {
  claude: ["ANTHROPIC_API_KEY", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "ANTHROPIC_SMALL_FAST_MODEL", "MAX_THINKING_TOKENS", "CLAUDE_CODE_MAX_OUTPUT_TOKENS"],
  codex: ["OPENAI_BASE_URL", "OPENAI_API_KEY"],
  hermes: ["OPENAI_BASE_URL", "OPENAI_API_KEY", "OPENROUTER_API_KEY"],
};

const tomlString = (s: string) => JSON.stringify(s);

export const agentDir = (home: string, harness: Harness) => join(home, "agents", harness);

export const readKey = (keyFile: string): string => {
  const k = readSecret(keyFile);
  if (!k) throw new Error(`key file ${keyFile} is missing or empty; launch the agent from the controller once`);
  return k;
};

export const buildLaunch = (i: LaunchInput): BuiltLaunch => {
  const G = i.gatewayUrl.replace(/\/+$/, "");
  const M = i.model;
  const client = clientOf(i.harness);
  switch (i.harness) {
    case "claude": {
      const configDir = agentDir(i.home, "claude");
      const env: Record<string, string> = {
        CLAUDE_CONFIG_DIR: configDir,
        ANTHROPIC_BASE_URL: G,
        ANTHROPIC_AUTH_TOKEN: readKey(i.keyFile),
        ANTHROPIC_MODEL: M,
        ANTHROPIC_DEFAULT_OPUS_MODEL: M,
        ANTHROPIC_DEFAULT_SONNET_MODEL: M,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: M,
        CLAUDE_CODE_SUBAGENT_MODEL: M,
        CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT: "1",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        DISABLE_AUTOUPDATER: "1",
        ANTHROPIC_CUSTOM_HEADERS: `X-Local-Studio-Client: ${client}\nX-Local-Studio-Workspace: ${i.sessionId}`,
      };
      if (i.contextWindow) env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = String(i.contextWindow);
      const statePath = join(configDir, ".claude.json");
      let state: { projects?: Record<string, Record<string, unknown>> } & Record<string, unknown> = {};
      try {
        state = JSON.parse(readFileSync(statePath, "utf8")) as typeof state;
      } catch {}
      state.hasCompletedOnboarding = true;
      if (!i.safe) state.bypassPermissionsModeAccepted = true;
      state.projects = { ...state.projects, [i.dir]: { ...state.projects?.[i.dir], hasTrustDialogAccepted: true } };
      const argv = ["claude", "--model", M, ...(i.safe ? [] : [YOLO.claude!])];
      return { argv, env, files: [{ path: statePath, content: `${JSON.stringify(state, null, 2)}\n`, mode: 0o600 }], cwd: i.dir };
    }
    case "codex": {
      const codexHome = agentDir(i.home, "codex");
      const t = tomlString;
      const config = [
        `model = ${t(M)}`,
        `model_provider = "localstudio"`,
        ...(i.contextWindow ? [`model_context_window = ${i.contextWindow}`, `model_auto_compact_token_limit = ${Math.floor(i.contextWindow * 0.9)}`] : []),
        "",
        "[model_providers.localstudio]",
        `name = "Local Studio"`,
        `base_url = ${t(`${G}/v1`)}`,
        `wire_api = "responses"`,
        `env_key = "LOCAL_STUDIO_API_KEY"`,
        `http_headers = { "X-Local-Studio-Client" = ${t(client)}, "X-Local-Studio-Workspace" = ${t(i.sessionId)} }`,
        "",
        `[projects.${t(i.dir)}]`,
        `trust_level = "trusted"`,
        "",
      ].join("\n");
      const argv = ["codex", "-C", i.dir, ...(i.safe ? [] : [YOLO.codex!])];
      return { argv, env: { CODEX_HOME: codexHome, LOCAL_STUDIO_API_KEY: readKey(i.keyFile) }, files: [{ path: join(codexHome, "config.toml"), content: config, mode: 0o600 }], cwd: i.dir };
    }
    case "pi":
    case "omp": {
      const dir = agentDir(i.home, i.harness);
      const model = { id: M, name: M, reasoning: true, input: i.vision ? ["text", "image"] : ["text"], ...(i.contextWindow ? { contextWindow: i.contextWindow } : {}), ...(i.harness === "omp" ? { omitMaxOutputTokens: true } : {}) };
      const provider = { baseUrl: `${G}/v1`, api: "openai-completions", apiKey: `!cat '${i.keyFile.replace(/'/g, `'\\''`)}'`, models: [model] };
      const file = { path: join(dir, i.harness === "pi" ? "models.json" : "models.yml"), content: `${JSON.stringify({ providers: { localstudio: provider } }, null, 2)}\n`, mode: 0o600 };
      const argv = [i.harness, "--model", `localstudio/${M}`];
      return { argv, env: { PI_CODING_AGENT_DIR: dir, ...(i.harness === "omp" ? { OMP_SKIP_SETUP: "1" } : {}) }, files: [file], cwd: i.dir };
    }
    case "hermes": {
      const dir = agentDir(i.home, "hermes");
      const q = JSON.stringify;
      const config = ["model:", `  default: ${q(M)}`, `  provider: "custom"`, `  base_url: ${q(`${G}/v1`)}`, `  api_key: ${q(readKey(i.keyFile))}`, ...(i.contextWindow ? [`  context_length: ${i.contextWindow}`] : []), ""].join("\n");
      const argv = ["hermes", ...(i.safe ? [] : [YOLO.hermes!]), "chat"];
      return { argv, env: { HERMES_HOME: dir }, files: [{ path: join(dir, "config.yaml"), content: config, mode: 0o600 }], cwd: i.dir };
    }
    case "droid": {
      const dir = agentDir(i.home, "droid");
      const path = join(dir, ".factory", "settings.json");
      let state: Record<string, unknown> & { trustedFolders?: Record<string, unknown>; sessionDefaultSettings?: Record<string, unknown> } = {};
      try {
        state = JSON.parse(readFileSync(path, "utf8")) as typeof state;
      } catch {}
      const id = "custom:localstudio-0";
      state.customModels = [{ model: M, id, index: 0, displayName: "localstudio", baseUrl: `${G}/v1`, apiKey: readKey(i.keyFile), provider: "generic-chat-completion-api", noImageSupport: !i.vision, ...(i.contextWindow ? { maxContextLimit: i.contextWindow } : {}), extraHeaders: { "X-Local-Studio-Client": client, "X-Local-Studio-Workspace": i.sessionId } }];
      state.sessionDefaultSettings = { ...state.sessionDefaultSettings, model: id };
      state.trustedFolders = { ...state.trustedFolders, [i.dir]: { trustedAt: new Date().toISOString() } };
      return { argv: ["droid"], env: { FACTORY_HOME_OVERRIDE: dir }, files: [{ path, content: `${JSON.stringify(state, null, 2)}\n`, mode: 0o600 }], cwd: i.dir };
    }
    default:
      throw new Error(`${i.harness} is not a terminal harness; it is launched by the controller`);
  }
};
