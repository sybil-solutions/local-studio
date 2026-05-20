import { existsSync, readFileSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { resolveDataDir } from "@/lib/data-dir";
import { listProjectsFromStore } from "./projects-store";

export type RuntimePluginRef = {
  id?: string;
  name?: string;
  path?: string;
  skillPath?: string;
  mcpConfigPath?: string;
  appConfigPath?: string;
  appIds?: string[];
  appPath?: string;
};

export type RuntimeSkillRef = {
  id?: string;
  name?: string;
  path?: string;
};

export type RuntimeStartOptions = {
  browserToolEnabled?: boolean;
  browserSessionId?: string;
  canvasEnabled?: boolean;
  plugins?: RuntimePluginRef[];
  skills?: RuntimeSkillRef[];
};

type RuntimeLaunchModel = {
  reasoning?: boolean;
};

type RuntimeMcpConfig = {
  pluginName: string;
  configPath: string;
};

export type RuntimeLaunchPlanInput = {
  agentDir: string;
  modelId: string;
  options: RuntimeStartOptions;
  pathEnv: string;
  piSessionId: string | null;
  processEnv: NodeJS.ProcessEnv;
  providerId: string;
  selectedModel: RuntimeLaunchModel;
};

export type RuntimeLaunchPlan = {
  args: string[];
  env: NodeJS.ProcessEnv;
  mcpConfigs: RuntimeMcpConfig[];
  plugins: RuntimePluginRef[];
};

export function normalizeBackendUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function resolveDefaultAgentCwd(): string {
  if (process.env.VLLM_STUDIO_AGENT_CWD) return process.env.VLLM_STUDIO_AGENT_CWD;

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

// Locate bundled Pi extensions in both development checkouts and packaged
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
    process.env.VLLM_STUDIO_BROWSER_EXTENSION_PATH,
  );
}

export function resolveCanvasExtensionPath(): string | null {
  return resolveBundledPiExtensionPath("canvas.ts", process.env.VLLM_STUDIO_CANVAS_EXTENSION_PATH);
}

export function resolveTimeoutExtensionPath(): string | null {
  return resolveBundledPiExtensionPath(
    "vllm-studio-timeouts.ts",
    process.env.VLLM_STUDIO_TIMEOUT_EXTENSION_PATH,
  );
}

export function resolveMcpExtensionPath(): string | null {
  return resolveBundledPiExtensionPath("mcp-plugin.ts", process.env.VLLM_STUDIO_MCP_EXTENSION_PATH);
}

export function pluginNameMatches(plugin: RuntimePluginRef, needle: string): boolean {
  return [
    plugin.id,
    plugin.name,
    plugin.path,
    plugin.skillPath,
    plugin.mcpConfigPath,
    plugin.appConfigPath,
    plugin.appPath,
  ]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(needle));
}

export function pluginFingerprint(options: RuntimeStartOptions): string {
  const names = (options.plugins ?? [])
    .map(
      (plugin) =>
        `${plugin.name ?? ""}:${plugin.path ?? ""}:${plugin.skillPath ?? ""}:${plugin.mcpConfigPath ?? ""}:${plugin.appConfigPath ?? ""}:${plugin.appIds?.join(",") ?? ""}:${plugin.appPath ?? ""}`,
    )
    .sort();
  const skills = (options.skills ?? [])
    .map((skill) => `${skill.name ?? ""}:${skill.path ?? ""}`)
    .sort();
  return JSON.stringify({
    browser: options.browserToolEnabled === true,
    browserSessionId: options.browserSessionId ?? "",
    canvas: options.canvasEnabled === true,
    plugins: names,
    skills,
  });
}

export function resolveComputerUseApp(plugins: RuntimePluginRef[]): string | null {
  const selected = plugins.find((plugin) => pluginNameMatches(plugin, "computer-use"));
  const candidates = [
    selected?.appPath,
    selected?.path && !selected.path.endsWith(".app")
      ? path.join(selected.path, "Codex Computer Use.app")
      : null,
    selected?.path,
    "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use/Codex Computer Use.app",
    path.join(resolveDataDir(), "computer-use", "Codex Computer Use.app"),
    path.join(homedir(), ".codex", "computer-use", "Codex Computer Use.app"),
  ].filter((value): value is string => Boolean(value));
  return (
    candidates.find((candidate) => candidate.endsWith(".app") && existsSync(candidate)) ?? null
  );
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

function isLaunchConstrainedComputerUseMcp(configPath: string): boolean {
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as {
      mcpServers?: Record<string, { command?: unknown; args?: unknown }>;
    };
    return Object.entries(parsed.mcpServers ?? {}).some(([name, server]) => {
      const marker =
        `${name} ${String(server.command ?? "")} ${Array.isArray(server.args) ? server.args.join(" ") : ""}`.toLowerCase();
      return marker.includes("computer-use") || marker.includes("skycomputeruseclient");
    });
  } catch {
    return false;
  }
}

function shouldLoadMcpConfig(plugin: RuntimePluginRef, configPath: string): boolean {
  if (process.env.VLLM_STUDIO_ENABLE_CODEX_COMPUTER_USE_MCP === "1") return true;
  if (isLocalComputerUseHelper(plugin, configPath)) return true;
  return !(
    pluginNameMatches(plugin, "computer-use") && isLaunchConstrainedComputerUseMcp(configPath)
  );
}

function isLocalComputerUseHelper(plugin: RuntimePluginRef, configPath: string): boolean {
  return (
    pluginNameMatches(plugin, "computer-use") &&
    localComputerUseRoots().some((root) => isPathInside(configPath, root))
  );
}

function localComputerUseRoots(): string[] {
  return [
    path.join(resolveDataDir(), "computer-use"),
    path.join(homedir(), ".codex", "computer-use"),
  ];
}

export function isPathInside(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function pluginMcpConfigs(plugins: RuntimePluginRef[]): RuntimeMcpConfig[] {
  const seen = new Set<string>();
  return plugins.flatMap((plugin) => {
    const configPath =
      plugin.mcpConfigPath ??
      (plugin.path && !plugin.path.endsWith(".app") ? path.join(plugin.path, ".mcp.json") : null);
    if (!configPath || !existsSync(configPath)) return [];
    const resolved = path.resolve(configPath);
    if (!shouldLoadMcpConfig(plugin, resolved)) return [];
    if (seen.has(resolved)) return [];
    seen.add(resolved);
    return [
      { pluginName: plugin.name || path.basename(path.dirname(resolved)), configPath: resolved },
    ];
  });
}

export function deriveFrontendBase(): string {
  const port = process.env.PORT || "3000";
  return `http://127.0.0.1:${port}`;
}

function shouldLoadBrowserTool(options: RuntimeStartOptions, plugins: RuntimePluginRef[]): boolean {
  return (
    options.browserToolEnabled === true ||
    plugins.some(
      (plugin) =>
        pluginNameMatches(plugin, "browser-use") || pluginNameMatches(plugin, "computer-use"),
    )
  );
}

function skillArgs(plugins: RuntimePluginRef[], skills: RuntimeSkillRef[]): string[] {
  return uniqueExistingPaths([...pluginSkillPaths(plugins), ...selectedSkillPaths(skills)]).flatMap(
    (skillPath) => ["--skill", skillPath],
  );
}

function extensionArgs(
  options: RuntimeStartOptions,
  plugins: RuntimePluginRef[],
  mcpConfigs: RuntimeMcpConfig[],
): string[] {
  const args: string[] = [];
  const timeoutExtensionPath = resolveTimeoutExtensionPath();
  if (timeoutExtensionPath) args.push("--extension", timeoutExtensionPath);
  if (mcpConfigs.length) {
    const mcpExtensionPath = resolveMcpExtensionPath();
    if (mcpExtensionPath) args.push("--extension", mcpExtensionPath);
  }
  if (shouldLoadBrowserTool(options, plugins)) {
    const browserExtensionPath = resolveBrowserExtensionPath();
    if (browserExtensionPath) args.push("--extension", browserExtensionPath);
  }
  if (options.canvasEnabled === true) {
    const canvasExtensionPath = resolveCanvasExtensionPath();
    if (canvasExtensionPath) args.push("--extension", canvasExtensionPath);
  }
  return args;
}

// Convert runtime selection state into the exact Pi RPC process contract. This
// is the launch seam: callers no longer need to know arg ordering, extension
// rules, skill path de-duping, or environment variable names.
export function buildPiLaunchPlan(input: RuntimeLaunchPlanInput): RuntimeLaunchPlan {
  const plugins = input.options.plugins ?? [];
  const skills = input.options.skills ?? [];
  const mcpConfigs = pluginMcpConfigs(plugins);
  const args = [
    "--mode",
    "rpc",
    "--provider",
    input.providerId,
    "--model",
    `${input.providerId}/${input.modelId}`,
  ];
  if (input.selectedModel.reasoning) args.push("--thinking", "high");
  if (input.piSessionId) args.push("--session", input.piSessionId);
  args.push(...skillArgs(plugins, skills), ...extensionArgs(input.options, plugins, mcpConfigs));

  return {
    args,
    env: {
      ...input.processEnv,
      PATH: input.pathEnv,
      PI_CODING_AGENT_DIR: input.agentDir,
      PI_SKIP_VERSION_CHECK: "1",
      VLLM_STUDIO_BROWSER_SESSION_ID: input.options.browserSessionId ?? "",
      VLLM_STUDIO_FRONTEND_BASE: input.processEnv.VLLM_STUDIO_FRONTEND_BASE ?? deriveFrontendBase(),
      VLLM_STUDIO_MCP_PLUGIN_CONFIGS: JSON.stringify(mcpConfigs),
    },
    mcpConfigs,
    plugins,
  };
}
