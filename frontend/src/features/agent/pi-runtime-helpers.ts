import { existsSync, readFileSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { listProjectsFromStore } from "@/features/agent/projects-store";

export type RuntimePluginRef = {
  id?: string;
  name?: string;
  path?: string;
  skillPath?: string;
  mcpConfigPath?: string;
};

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
  browserToolEnabled?: boolean;
  browserSessionId?: string;
  browserBackend?: "embedded" | "sitegeist";
  // Runtime (focused) session id, so the plan extension writes the plan the
  // Plan panel reads for the same session.
  planSessionId?: string;
  canvasEnabled?: boolean;
  plugins?: RuntimePluginRef[];
  skills?: RuntimeSkillRef[];
  promptTemplates?: RuntimePromptTemplateRef[];
  // Changes only when a managed OAuth token is refreshed, so the runtime
  // restarts (respawning MCP servers) once a prior token has expired.
  managedTokenFingerprint?: string;
};

type RuntimeMcpConfig = {
  pluginName: string;
  configPath: string;
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
export async function resolveAgentCwd(input?: string): Promise<string> {
  const defaultCwd = resolveDefaultAgentCwd();
  const raw = input?.trim() || defaultCwd;
  const expanded = expandHome(raw);
  const candidate = path.isAbsolute(expanded) ? expanded : path.resolve(defaultCwd, expanded);
  const resolved = await realpath(candidate);
  const info = await stat(resolved);
  if (!info.isDirectory()) {
    throw new Error(`Agent cwd is not a directory: ${resolved}`);
  }
  return resolved;
}

// Locate bundled first-party extensions in both development checkouts and packaged
// Electron resource directories. Environment overrides keep this testable and
// let desktop packaging repair paths without changing runtime code.
export function resolveBundledPiExtensionPath(
  fileName: string,
  envOverride?: string,
): string | null {
  const candidates = [
    envOverride,
    process.resourcesPath
      ? path.join(process.resourcesPath, "desktop", "resources", "pi-extensions", fileName)
      : null,
    path.resolve(process.cwd(), "frontend", "desktop", "resources", "pi-extensions", fileName),
    path.resolve(process.cwd(), "desktop", "resources", "pi-extensions", fileName),
    path.resolve(
      process.cwd(),
      "..",
      "frontend",
      "desktop",
      "resources",
      "pi-extensions",
      fileName,
    ),
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
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

export function resolveCanvasExtensionPath(): string | null {
  return resolveBundledPiExtensionPath("canvas.ts", process.env.LOCAL_STUDIO_CANVAS_EXTENSION_PATH);
}

export function resolvePlanExtensionPath(): string | null {
  return resolveBundledPiExtensionPath("plan.ts", process.env.LOCAL_STUDIO_PLAN_EXTENSION_PATH);
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

export function resolveMcpExtensionPath(): string | null {
  return resolveBundledPiExtensionPath(
    "mcp-plugin.ts",
    process.env.LOCAL_STUDIO_MCP_EXTENSION_PATH,
  );
}

// Locate a bundled skill directory (contains SKILL.md). Searched only when the
// matching tool surface is ON so it can be appended to the SDK skill list and
// teach the model how/when to use those tools.
function resolveBundledSkillPath(name: string, override?: string): string | null {
  const candidates = [
    override,
    process.resourcesPath
      ? path.join(process.resourcesPath, "desktop", "resources", "skills", name)
      : null,
    path.resolve(process.cwd(), "frontend", "desktop", "resources", "skills", name),
    path.resolve(process.cwd(), "desktop", "resources", "skills", name),
    path.resolve(process.cwd(), "..", "frontend", "desktop", "resources", "skills", name),
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
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

export function resolveCanvasSkillPath(): string | null {
  return resolveBundledSkillPath("canvas", process.env.LOCAL_STUDIO_CANVAS_SKILL_PATH);
}

export function resolvePlanSkillPath(): string | null {
  return resolveBundledSkillPath("plan", process.env.LOCAL_STUDIO_PLAN_SKILL_PATH);
}

export function pluginFingerprint(options: RuntimeStartOptions): string {
  const names = (options.plugins ?? [])
    .map(
      (plugin) =>
        `${plugin.name ?? ""}:${plugin.path ?? ""}:${plugin.skillPath ?? ""}:${plugin.mcpConfigPath ?? ""}`,
    )
    .sort();
  const skills = (options.skills ?? [])
    .map((skill) => `${skill.name ?? ""}:${skill.path ?? ""}`)
    .sort();
  const promptTemplates = (options.promptTemplates ?? [])
    .map((template) => `${template.name ?? ""}:${template.path ?? ""}`)
    .sort();
  return JSON.stringify({
    browser: options.browserToolEnabled === true,
    browserBackend: browserBackend(options),
    browserSessionId: options.browserSessionId ?? "",
    canvas: options.canvasEnabled === true,
    plugins: names,
    skills,
    promptTemplates,
    managedToken: options.managedTokenFingerprint ?? "",
  });
}

export function pluginSkillPaths(plugins: RuntimePluginRef[]): string[] {
  return uniqueExistingPaths(
    plugins.flatMap((plugin) => [
      plugin.skillPath,
      plugin.path && !plugin.path.endsWith(".app") ? path.join(plugin.path, "skills") : null,
    ]),
  );
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

export function pluginMcpConfigs(plugins: RuntimePluginRef[]): RuntimeMcpConfig[] {
  const seen = new Set<string>();
  return plugins.flatMap((plugin) => {
    const configPath =
      plugin.mcpConfigPath ??
      (plugin.path && !plugin.path.endsWith(".app") ? path.join(plugin.path, ".mcp.json") : null);
    if (!configPath || !existsSync(configPath)) return [];
    const resolved = path.resolve(configPath);
    if (seen.has(resolved)) return [];
    seen.add(resolved);
    return [
      { pluginName: plugin.name || path.basename(path.dirname(resolved)), configPath: resolved },
    ];
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

function runtimeExtensionPaths(
  options: RuntimeStartOptions,
  mcpConfigs: RuntimeMcpConfig[],
): string[] {
  const timeoutExtensionPath = resolveTimeoutExtensionPath();
  const agentPolicyExtensionPath = resolveAgentPolicyExtensionPath();
  const browserExtensionPath = shouldLoadBrowserTool(options)
    ? browserExtensionPathFor(browserBackend(options))
    : null;
  return uniqueExistingPaths([
    timeoutExtensionPath,
    agentPolicyExtensionPath,
    // Plan tools are always available: the Plan panel is a core surface, so the
    // model can always populate it instead of writing a plan file to the repo.
    resolvePlanExtensionPath(),
    mcpConfigs.length ? resolveMcpExtensionPath() : null,
    browserExtensionPath,
    options.canvasEnabled === true ? resolveCanvasExtensionPath() : null,
  ]);
}

function runtimeSkillPaths(options: RuntimeStartOptions, plugins: RuntimePluginRef[]): string[] {
  const loadBrowser = shouldLoadBrowserTool(options);
  const backend = browserBackend(options);
  return uniqueExistingPaths([
    ...pluginSkillPaths(plugins),
    ...selectedSkillPaths(options.skills ?? []),
    loadBrowser ? browserSkillPathFor(backend) : null,
    resolvePlanSkillPath(),
    options.canvasEnabled === true ? resolveCanvasSkillPath() : null,
  ]);
}

function runtimeEnvInjections(
  options: RuntimeStartOptions,
  mcpConfigs: RuntimeMcpConfig[],
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  const frontendBase = env.LOCAL_STUDIO_FRONTEND_BASE ?? deriveFrontendBase(env);
  const relay = readSitegeistRelayEnv(env);
  return {
    LOCAL_STUDIO_BROWSER_SESSION_ID: options.browserSessionId ?? "",
    LOCAL_STUDIO_PLAN_SESSION_ID: options.planSessionId ?? "",
    LOCAL_STUDIO_FRONTEND_BASE: frontendBase,
    LOCAL_STUDIO_MCP_PLUGIN_CONFIGS: JSON.stringify(mcpConfigs),
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

export async function buildAgentSessionOptions(
  input: AgentSessionOptionsInput,
): Promise<AgentSessionOptions> {
  const options = input.options;
  const plugins = options.plugins ?? [];
  const mcpConfigs = pluginMcpConfigs(plugins);
  return {
    extensionPaths: runtimeExtensionPaths(options, mcpConfigs),
    skills: runtimeSkillPaths(options, plugins),
    promptTemplatePaths: selectedPromptTemplatePaths(options.promptTemplates ?? []),
    envInjections: runtimeEnvInjections(options, mcpConfigs, input.processEnv ?? process.env),
  };
}
