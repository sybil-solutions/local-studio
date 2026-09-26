import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { HARNESS_CLIENT } from "@local-studio/contracts";
import { readKey } from "./launch-table";
import { shq } from "./tmux";

export interface DesktopInput {
  home: string;
  dir: string;
  model: string;
  contextWindow: number | null;
  keyFile: string;
  gatewayUrl: string;
  sessionId: string;
}

export interface DesktopPrepared {
  files: string[];
  open: string[];
  command: string;
  note: string;
}

const put = (path: string, content: string) => {
  mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
  writeFileSync(path, content, { mode: 0o600 });
  chmodSync(path, 0o600);
};

const q = (s: string) => JSON.stringify(s);

export const prepareCodexDesktop = (i: DesktopInput): DesktopPrepared => {
  const codexHome = join(i.home, "agents", "codex-home");
  const cfg = join(codexHome, "config.toml");
  const G = i.gatewayUrl.replace(/\/+$/, "");
  const lines = [
    `model = ${q(i.model)}`,
    `model_provider = "localstudio"`,
    ...(i.contextWindow ? [`model_context_window = ${i.contextWindow}`, `model_auto_compact_token_limit = ${Math.floor(i.contextWindow * 0.9)}`] : []),
    "",
    "[model_providers.localstudio]",
    `name = "Local Studio"`,
    `base_url = ${q(`${G}/v1`)}`,
    `wire_api = "responses"`,
    `experimental_bearer_token = ${q(readKey(i.keyFile))}`,
    `http_headers = { "X-Local-Studio-Client" = ${q(HARNESS_CLIENT["codex-desktop"])}, "X-Local-Studio-Workspace" = ${q(i.sessionId)} }`,
    "",
    `[projects.${q(i.dir)}]`,
    `trust_level = "trusted"`,
    "",
  ];
  put(cfg, lines.join("\n"));
  return {
    files: [cfg],
    open: ["open", "-a", "/Applications/Codex.app", "--env", `CODEX_HOME=${codexHome}`, i.dir],
    command: `open -a Codex --env CODEX_HOME=${shq(codexHome)} ${shq(i.dir)}`,
    note: "If Codex was already running it keeps its old CODEX_HOME: quit it and launch again. The key is in the private 0600 config, not on argv. Codex may still ask for ChatGPT sign-in.",
  };
};

export const prepareClaudeDesktop = (i: DesktopInput): DesktopPrepared => {
  const base = join(i.home, "agents", "claude-desktop");
  const lib = join(base, "configLibrary");
  const metaPath = join(lib, "_meta.json");
  let id: string = randomUUID();
  if (existsSync(metaPath)) {
    try {
      const m = JSON.parse(readFileSync(metaPath, "utf8")) as { appliedId?: string };
      if (m.appliedId && /^[0-9a-f-]{36}$/.test(m.appliedId)) id = m.appliedId;
    } catch {}
  }
  const entry = {
    inferenceProvider: "gateway",
    inferenceGatewayBaseUrl: i.gatewayUrl.replace(/\/+$/, ""),
    inferenceGatewayApiKey: readKey(i.keyFile),
    inferenceGatewayAuthScheme: "bearer",
    modelDiscoveryEnabled: true,
    inferenceModels: [i.model],
    inferenceCustomHeaders: { "X-Local-Studio-Client": HARNESS_CLIENT["claude-desktop"], "X-Local-Studio-Workspace": i.sessionId },
  };
  const entryPath = join(lib, `${id}.json`);
  put(entryPath, `${JSON.stringify(entry, null, 2)}\n`);
  put(metaPath, `${JSON.stringify({ appliedId: id }, null, 2)}\n`);
  const cfgPath = join(base, "claude_desktop_config.json");
  put(cfgPath, `${JSON.stringify({ deploymentMode: "3p" }, null, 2)}\n`);
  const target = join(homedir(), "Library", "Application Support", "Claude-3p");
  return {
    files: [entryPath, metaPath, cfgPath],
    open: ["open", "-a", "/Applications/Claude.app"],
    command: `cp -R ${shq(lib)} ${shq(target)}/ && open -a Claude`,
    note: `Local Studio does not write into Claude's userData. Quit Claude, merge ${cfgPath} and the configLibrary folder into ${target}, then relaunch. Or open Claude, choose third-party inference, and enter gateway base URL ${i.gatewayUrl}, auth scheme bearer, model ${i.model}, API key from ${i.keyFile}.`,
  };
};
