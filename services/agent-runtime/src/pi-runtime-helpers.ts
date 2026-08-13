import { existsSync, readFileSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { listProjectsFromStore, resolveAllowedWorkspace } from "./projects-store";
import { hasEnabledConnectorsSync } from "./connectors-service";
import type { AgentThinkingLevel, AgentToolAccess } from "../../../shared/agent/agent-turn";

export type RuntimeSkillRef = {
  id?: string;
  name?: string;
  path?: string;
};

export type RuntimePromptTemplateRef = {
  id?: string;
  name?: string;
  path?: string;
};

export type RuntimeStartOptions = {
  thinkingLevel?: AgentThinkingLevel;
  toolAccess?: AgentToolAccess;
  browserToolEnabled?: boolean;
  browserSessionId?: string;
  browserBackend?: "embedded" | "sitegeist";
  skills?: RuntimeSkillRef[];
  promptTemplates?: RuntimePromptTemplateRef[];
};

export type AgentSessionOptionsInput = {
  options: RuntimeStartOptions;
  processEnv?: NodeJS.ProcessEnv;
};

export type AgentSessionOptions = {
  // Absolute filesystem paths to .ts/.js extension modules. The SDK's
  // resource-loader uses jiti to load these; we hand paths instead of
  // pre-imported factories so we never trigger webpack's static analyser on a
  // dynamic `import(variable)` in the Next runtime bundle.
  extensionPaths: string[];
  skills: string[];
  /** Absolute prompt-template file/dir paths; forwarded to the SDK. */
  promptTemplatePaths: string[];
  envInjections: Record<string, string>;
};

function resolveDefaultAgentCwd(): string {
  if (process.env.LOCAL_STUDIO_AGENT_CWD) return process.env.LOCAL_STUDIO_AGENT_CWD;

  try {
    const usable = listProjectsFromStore().find((entry) => entry.exists);
    if (usable) return usable.path;
  } catch {
    // The project registry is optional during first run and test setup.
  }

  const cwd = process.cwd();
  if (path.basename(cwd) === "frontend") return path.resolve(cwd, "..");
  if (cwd === "/" || cwd === "") return homedir();
  return cwd;
}

export function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith(`~${path.sep}`)) return path.join(homedir(), value.slice(2));
  return value;
}

// Resolve user-facing cwd input into the concrete directory Pi should run in.
// The default keeps packaged Electron launches out of "/" by preferring the
// selected project registry, then repo root during dev, then the user home.
export function resolveAgentCwdEffect(input?: string): Effect.Effect<string, unknown> {
  const defaultCwd = resolveDefaultAgentCwd();
  const raw = input?.trim() || defaultCwd;
  const expanded = expandHome(raw);
  const candidate = path.isAbsolute(expanded) ? expanded : path.resolve(defaultCwd, expanded);
  return Effect.gen(function* () {
    const resolved = yield* Effect.tryPromise({
      try: () => realpath(candidate),
      catch: (error) => error,
    });
    const info = yield* Effect.tryPromise({
      try: () => stat(resolved),
      catch: (error) => error,
    });
    if (!info.isDirectory()) {
      return yield* Effect.fail(new Error(`Agent cwd is not a directory: ${resolved}`));
    }
    return resolveAllowedWorkspace(resolved);
  });
}

// Bundled desktop resources live at <repo>/frontend/desktop/resources/<kind>/.
// Resolution has to work from three different working directories: the repo
// root (dev), frontend/ (next build), and services/agent-runtime — the deployed
// systemd unit's WorkingDirectory. The old ladder only ever tried one "..", so
// on the server EVERY bundled extension, MCP server and skill silently failed
// to resolve and none of them loaded. Walk up instead of enumerating.
function resolveBundledResourcePath(kind: string, name: string, override?: string): string | null {
  if (override && existsSync(override)) return override;
  // The desktop shell forks this runtime as a plain Node child, where
  // Electron's `process.resourcesPath` does NOT exist — it forwards the same
  // path via env instead. Missing this meant every bundled extension
  // (subagent, automations, browser) silently vanished in packaged
  // builds while working in dev, where the cwd walk below finds the repo.
  const resourcesRoot = process.env.LOCAL_STUDIO_RESOURCES_PATH?.trim() || process.resourcesPath;
  if (resourcesRoot) {
    const packaged = path.join(resourcesRoot, "desktop", "resources", kind, name);
    if (existsSync(packaged)) return packaged;
  }
  let dir = process.cwd();
  for (let depth = 0; depth < 5; depth += 1) {
    for (const prefix of [
      ["frontend", "desktop", "resources"],
      ["desktop", "resources"],
    ]) {
      const candidate = path.join(dir, ...prefix, kind, name);
      if (existsSync(candidate)) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function resolveBundledPiExtensionPath(
  fileName: string,
  envOverride?: string,
): string | null {
  return resolveBundledResourcePath("pi-extensions", fileName, envOverride);
}

export function resolveBrowserExtensionPath(): string | null {
  return resolveBundledPiExtensionPath(
    "browser.ts",
    process.env.LOCAL_STUDIO_BROWSER_EXTENSION_PATH,
  );
}

export function resolveSitegeistBrowserExtensionPath(): string | null {
  return resolveBundledPiExtensionPath(
    "sitegeist-browser.ts",
    process.env.LOCAL_STUDIO_SITEGEIST_BROWSER_EXTENSION_PATH,
  );
}

/** Bundled stdio MCP servers (desktop/resources/mcp) — same ladder as extensions. */
export function resolveBundledMcpServerPath(fileName: string): string | null {
  return resolveBundledResourcePath("mcp", fileName);
}

export function resolveConnectorsExtensionPath(): string | null {
  return resolveBundledPiExtensionPath(
    "connectors.ts",
    process.env.LOCAL_STUDIO_CONNECTORS_EXTENSION_PATH,
  );
}

export function resolveSubagentsExtensionPath(): string | null {
  return resolveBundledPiExtensionPath(
    "subagents.ts",
    process.env.LOCAL_STUDIO_SUBAGENTS_EXTENSION_PATH,
  );
}

export function resolveAutomationsExtensionPath(): string | null {
  return resolveBundledPiExtensionPath(
    "automations.ts",
    process.env.LOCAL_STUDIO_AUTOMATIONS_EXTENSION_PATH,
  );
}

export function resolveTimeoutExtensionPath(): string | null {
  return resolveBundledPiExtensionPath(
    "local-studio-timeouts.ts",
    process.env.LOCAL_STUDIO_TIMEOUT_EXTENSION_PATH,
  );
}

export function resolveAgentPolicyExtensionPath(): string | null {
  return resolveBundledPiExtensionPath(
    "local-studio-agent-policy.ts",
    process.env.LOCAL_STUDIO_AGENT_POLICY_EXTENSION_PATH,
  );
}

// Locate a bundled skill directory (contains SKILL.md). Searched only when the
// matching tool surface is ON so it can be appended to the SDK skill list and
// teach the model how/when to use those tools.
function resolveBundledSkillPath(name: string, override?: string): string | null {
  return resolveBundledResourcePath("skills", name, override);
}

export function resolveBrowserSkillPath(): string | null {
  return resolveBundledSkillPath("browser", process.env.LOCAL_STUDIO_BROWSER_SKILL_PATH);
}

export function resolveSitegeistBrowserSkillPath(): string | null {
  return resolveBundledSkillPath(
    "sitegeist-browser",
    process.env.LOCAL_STUDIO_SITEGEIST_BROWSER_SKILL_PATH,
  );
}

export function runtimeOptionsFingerprint(options: RuntimeStartOptions): string {
  const skills = (options.skills ?? [])
    .map((skill) => `${skill.name ?? ""}:${skill.path ?? ""}`)
    .sort();
  const promptTemplates = (options.promptTemplates ?? [])
    .map((template) => `${template.name ?? ""}:${template.path ?? ""}`)
    .sort();
  return JSON.stringify({
    thinkingLevel: options.thinkingLevel ?? "high",
    toolAccess: options.toolAccess ?? "full",
    browser: options.browserToolEnabled === true,
    browserBackend: browserBackend(options),
    browserSessionId: options.browserSessionId ?? "",
    skills,
    promptTemplates,
  });
}

export function selectedSkillPaths(skills: RuntimeSkillRef[]): string[] {
  return uniqueExistingPaths(skills.map((skill) => skill.path));
}

export function selectedPromptTemplatePaths(templates: RuntimePromptTemplateRef[]): string[] {
  return uniqueExistingPaths(templates.map((template) => template.path));
}

export function uniqueExistingPaths(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  return values.filter((value): value is string => {
    if (!value || !existsSync(value)) return false;
    const resolved = path.resolve(value);
    if (seen.has(resolved)) return false;
    seen.add(resolved);
    return true;
  });
}

export function deriveFrontendBase(env: NodeJS.ProcessEnv = process.env): string {
  const port = env.PORT || "3000";
  return `http://127.0.0.1:${port}`;
}

function shouldLoadBrowserTool(options: RuntimeStartOptions): boolean {
  return options.browserToolEnabled === true;
}

function browserBackend(options: RuntimeStartOptions): "embedded" | "sitegeist" {
  const backend = options.browserBackend ?? process.env.LOCAL_STUDIO_BROWSER_BACKEND;
  if (backend === "sitegeist") return "sitegeist";
  return "embedded";
}

function browserExtensionPathFor(backend: "embedded" | "sitegeist"): string | null {
  if (backend === "sitegeist") return resolveSitegeistBrowserExtensionPath();
  return resolveBrowserExtensionPath();
}

function browserSkillPathFor(backend: "embedded" | "sitegeist"): string | null {
  if (backend === "sitegeist") return resolveSitegeistBrowserSkillPath();
  return resolveBrowserSkillPath();
}

function runtimeExtensionPaths(options: RuntimeStartOptions): string[] {
  const timeoutExtensionPath = resolveTimeoutExtensionPath();
  const agentPolicyExtensionPath = resolveAgentPolicyExtensionPath();
  const browserExtensionPath = shouldLoadBrowserTool(options)
    ? browserExtensionPathFor(browserBackend(options))
    : null;
  return uniqueExistingPaths([
    timeoutExtensionPath,
    agentPolicyExtensionPath,
    browserExtensionPath,
    hasEnabledConnectorsSync() ? resolveConnectorsExtensionPath() : null,
    resolveSubagentsExtensionPath(),
    // Lets the agent create/list/delete scheduled automations.
    resolveAutomationsExtensionPath(),
    // NOTE: session-goal injection is no longer a bundled extension — it runs
    // in-process via createGoalPromptExtension (see pi-runtime.ts), keyed by the
    // canonical piSessionId. A bundled extension read the wrong id over RPC.
  ]);
}

function runtimeSkillPaths(options: RuntimeStartOptions): string[] {
  const loadBrowser = shouldLoadBrowserTool(options);
  const backend = browserBackend(options);
  return uniqueExistingPaths([
    ...selectedSkillPaths(options.skills ?? []),
    loadBrowser ? browserSkillPathFor(backend) : null,
  ]);
}

function runtimeEnvInjections(
  options: RuntimeStartOptions,
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  const frontendBase = env.LOCAL_STUDIO_FRONTEND_BASE ?? deriveFrontendBase(env);
  const relay = readSitegeistRelayEnv(env);
  return {
    LOCAL_STUDIO_BROWSER_SESSION_ID: options.browserSessionId ?? "",
    LOCAL_STUDIO_FRONTEND_BASE: frontendBase,
    SITEGEIST_RELAY_URL: env.SITEGEIST_RELAY_URL ?? relay.SITEGEIST_RELAY_URL ?? "",
    SITEGEIST_RELAY_TOKEN: env.SITEGEIST_RELAY_TOKEN ?? relay.SITEGEIST_RELAY_TOKEN ?? "",
    SITEGEIST_RELAY_SESSION_ID: options.browserSessionId ?? "",
  };
}

function readSitegeistRelayEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const filePath = expandHome(
    env.LOCAL_STUDIO_SITEGEIST_RELAY_ENV_PATH ?? "~/.config/sitegeist-relay/env",
  );
  if (!existsSync(filePath)) return {};
  try {
    return Object.fromEntries(
      readFileSync(filePath, "utf8")
        .split(/\r?\n/)
        .flatMap((line): Array<[string, string]> => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) return [];
          const clean = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
          const index = clean.indexOf("=");
          if (index < 1) return [];
          const key = clean.slice(0, index).trim();
          const value = clean
            .slice(index + 1)
            .trim()
            .replace(/^['"]|['"]$/g, "");
          return key.startsWith("SITEGEIST_RELAY_") ? [[key, value]] : [];
        }),
    );
  } catch {
    return {};
  }
}

export function applyRuntimeEnvInjections(
  envInjections: Record<string, string>,
  env: NodeJS.ProcessEnv = process.env,
): void {
  for (const [key, value] of Object.entries(envInjections)) env[key] = value;
}

export function buildAgentSessionOptionsSync(input: AgentSessionOptionsInput): AgentSessionOptions {
  const options = input.options;
  return {
    extensionPaths: runtimeExtensionPaths(options),
    skills: runtimeSkillPaths(options),
    promptTemplatePaths: selectedPromptTemplatePaths(options.promptTemplates ?? []),
    envInjections: runtimeEnvInjections(options, input.processEnv ?? process.env),
  };
}
