import type { BuiltLaunch, Harness } from "@local-studio/contracts";
import { HARNESS_CLIENT } from "@local-studio/contracts";
import { readSecret } from "./keys";

export interface LaunchInput {
  harness: Harness;
  model: string;
  contextWindow: number | null;
  vision: boolean | null;
  dir: string;
  keyFile: string;
  gatewayUrl: string;
  workspaceId: string;
  resume: boolean;
  safe: boolean;
  extraArgs?: string[];
}

export const SAFE_FLAG = "--safe";

export const YOLO: Partial<Record<Harness, string>> = {
  claude: "--dangerously-skip-permissions",
  codex: "--dangerously-bypass-approvals-and-sandbox",
};

export const ENV_UNSET: Partial<Record<Harness, string[]>> = {
  claude: ["ANTHROPIC_API_KEY", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "ANTHROPIC_SMALL_FAST_MODEL", "MAX_THINKING_TOKENS", "CLAUDE_CODE_MAX_OUTPUT_TOKENS"],
  codex: ["OPENAI_BASE_URL"],
};

const tomlString = (s: string) => JSON.stringify(s);

export const readKey = (keyFile: string): string => {
  const k = readSecret(keyFile);
  if (!k) throw new Error(`key file ${keyFile} is missing or empty; launch the workspace from the controller once`);
  return k;
};

export const buildLaunch = (i: LaunchInput): BuiltLaunch => {
  const G = i.gatewayUrl.replace(/\/+$/, "");
  const M = i.model;
  const client = HARNESS_CLIENT[i.harness];
  const extra = (i.extraArgs ?? []).filter((a) => a !== SAFE_FLAG);
  switch (i.harness) {
    case "claude": {
      const env: Record<string, string> = {
        ANTHROPIC_BASE_URL: G,
        ANTHROPIC_AUTH_TOKEN: readKey(i.keyFile),
        ANTHROPIC_MODEL: M,
        ANTHROPIC_DEFAULT_OPUS_MODEL: M,
        ANTHROPIC_DEFAULT_SONNET_MODEL: M,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: M,
        CLAUDE_CODE_SUBAGENT_MODEL: M,
        CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT: "1",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        ANTHROPIC_CUSTOM_HEADERS: `X-Local-Studio-Client: ${client}\nX-Local-Studio-Workspace: ${i.workspaceId}`,
      };
      if (i.contextWindow) env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = String(i.contextWindow);
      const argv = ["claude", "--model", M];
      if (!i.safe) argv.push(YOLO.claude!);
      if (i.resume) argv.push("--continue");
      argv.push(...extra);
      return { argv, env, files: [], cwd: i.dir };
    }
    case "codex": {
      const headers = `{${tomlString("X-Local-Studio-Client")}=${tomlString(client)},${tomlString("X-Local-Studio-Workspace")}=${tomlString(i.workspaceId)}}`;
      const opts = [
        "-C",
        i.dir,
        "-c",
        `model_providers.localstudio.name=${tomlString("Local Studio")}`,
        "-c",
        `model_providers.localstudio.base_url=${tomlString(`${G}/v1`)}`,
        "-c",
        `model_providers.localstudio.wire_api=${tomlString("responses")}`,
        "-c",
        `model_providers.localstudio.env_key=${tomlString("LOCAL_STUDIO_API_KEY")}`,
        "-c",
        `model_providers.localstudio.http_headers=${headers}`,
        "-c",
        `model_provider=${tomlString("localstudio")}`,
        "-c",
        `model=${tomlString(M)}`,
        "-c",
        `projects={${tomlString(i.dir)}={trust_level=${tomlString("trusted")}}}`,
      ];
      if (i.contextWindow) {
        opts.push("-c", `model_context_window=${i.contextWindow}`);
        opts.push("-c", `model_auto_compact_token_limit=${Math.floor(i.contextWindow * 0.9)}`);
      }
      if (!i.safe) opts.push(YOLO.codex!);
      const argv = i.resume ? ["codex", "resume", "--last", ...opts, ...extra] : ["codex", ...opts, ...extra];
      return { argv, env: { LOCAL_STUDIO_API_KEY: readKey(i.keyFile) }, files: [], cwd: i.dir };
    }
    default:
      throw new Error(`${i.harness} is not a terminal harness; it is launched by the controller`);
  }
};
