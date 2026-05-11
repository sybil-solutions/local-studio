import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { getApiSettings, type ApiSettings } from "@/lib/api-settings";
import { resolveDataDir } from "@/lib/data-dir";
import { normalizeOpenAIModels, modelsToPiModels, type AgentModel } from "./models";
import { isAgentEndEvent } from "./pi-events";
import { piPathEnv, resolvePiLaunchCommand } from "./pi-binary";
import { listProjectsFromStore } from "./projects-store";

const PROVIDER_ID = "vllm-studio";
const DEFAULT_SESSION_ID = "default";
const RPC_COMMAND_TIMEOUT_MS = 30_000;

type PiResponse = {
  id?: string;
  type: "response";
  command?: string;
  success?: boolean;
  data?: unknown;
  error?: string | { message?: string };
};

type PiEvent = Record<string, unknown> & { type?: string };

export type LoggedPiEvent = {
  seq: number;
  event: PiEvent;
  timestamp: string;
};

type PendingCommand = {
  resolve: (response: PiResponse) => void;
  reject: (error: Error) => void;
};

type RuntimePluginRef = {
  id?: string;
  name?: string;
  path?: string;
  skillPath?: string;
  mcpConfigPath?: string;
  appConfigPath?: string;
  appIds?: string[];
  appPath?: string;
};

type RuntimeSkillRef = {
  id?: string;
  name?: string;
  path?: string;
};

type RuntimeStartOptions = {
  browserToolEnabled?: boolean;
  plugins?: RuntimePluginRef[];
  skills?: RuntimeSkillRef[];
};

function normalizeBackendUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function resolveDefaultAgentCwd(): string {
  // Explicit override always wins.
  if (process.env.VLLM_STUDIO_AGENT_CWD) return process.env.VLLM_STUDIO_AGENT_CWD;

  // In a packaged Electron app, process.cwd() is "/" — useless as a working
  // directory for the coding agent. If the renderer hasn't picked a project,
  // fall back to the most recently added project on disk, then to $HOME.
  try {
    const projects = listProjectsFromStore();
    const usable = projects.find((entry) => entry.exists);
    if (usable) return usable.path;
  } catch {
    // ignore — projects.json may not exist yet
  }

  // Dev: if cwd is the frontend/ dir, use the repo root.
  const cwd = process.cwd();
  if (path.basename(cwd) === "frontend") return path.resolve(cwd, "..");

  // Bare process.cwd() === "/" is unusable; prefer $HOME.
  if (cwd === "/" || cwd === "") return homedir();
  return cwd;
}

function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith(`~${path.sep}`)) return path.join(homedir(), value.slice(2));
  return value;
}

async function resolveAgentCwd(input?: string): Promise<string> {
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

// Locate bundled Pi extensions. In dev they sit next to the source files;
// in a packaged Electron app they ship under
// process.resourcesPath/desktop/resources/pi-extensions/. We accept either.
function resolveBundledPiExtensionPath(fileName: string, envOverride?: string): string | null {
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

function resolveBrowserExtensionPath(): string | null {
  return resolveBundledPiExtensionPath(
    "browser.ts",
    process.env.VLLM_STUDIO_BROWSER_EXTENSION_PATH,
  );
}

function resolveTimeoutExtensionPath(): string | null {
  return resolveBundledPiExtensionPath(
    "vllm-studio-timeouts.ts",
    process.env.VLLM_STUDIO_TIMEOUT_EXTENSION_PATH,
  );
}

function resolveMcpExtensionPath(): string | null {
  return resolveBundledPiExtensionPath("mcp-plugin.ts", process.env.VLLM_STUDIO_MCP_EXTENSION_PATH);
}

function pluginNameMatches(plugin: RuntimePluginRef, needle: string): boolean {
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

function pluginFingerprint(options: RuntimeStartOptions): string {
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
    plugins: names,
    skills,
  });
}

function resolveComputerUseApp(plugins: RuntimePluginRef[]): string | null {
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

function launchComputerUseApp(plugins: RuntimePluginRef[]) {
  if (process.platform !== "darwin") return;
  const appPath = resolveComputerUseApp(plugins);
  if (!appPath) return;
  const child = spawn("open", ["-gj", appPath], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

function pluginSkillPaths(plugins: RuntimePluginRef[]): string[] {
  return uniqueExistingPaths(
    plugins.flatMap((plugin) => [
      plugin.skillPath,
      plugin.path && !plugin.path.endsWith(".app") ? path.join(plugin.path, "skills") : null,
    ]),
  );
}

function selectedSkillPaths(skills: RuntimeSkillRef[]): string[] {
  return uniqueExistingPaths(skills.map((skill) => skill.path));
}

function uniqueExistingPaths(values: Array<string | null | undefined>): string[] {
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

function isPathInside(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function pluginMcpConfigs(
  plugins: RuntimePluginRef[],
): Array<{ pluginName: string; configPath: string }> {
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

function deriveFrontendBase(): string {
  const port = process.env.PORT || "3000";
  return `http://127.0.0.1:${port}`;
}

async function fetchModelsFromBackend(settings: ApiSettings): Promise<AgentModel[]> {
  const backendUrl = normalizeBackendUrl(settings.backendUrl);
  const headers: HeadersInit = { Accept: "application/json" };
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
  const response = await fetch(`${backendUrl}/v1/models`, { headers, cache: "no-store" });
  if (!response.ok) {
    throw new Error(`/v1/models failed with HTTP ${response.status}`);
  }
  const payload = (await response.json()) as unknown;
  return normalizeOpenAIModels(payload && typeof payload === "object" ? payload : {});
}

async function writePiModelsConfig(settings: ApiSettings, models: AgentModel[]): Promise<string> {
  const dataDir = resolveDataDir();
  const agentDir = path.join(dataDir, "pi-agent");
  await mkdir(agentDir, { recursive: true });
  await chmod(agentDir, 0o700).catch(() => undefined);

  const backendUrl = normalizeBackendUrl(settings.backendUrl);
  const config = {
    providers: {
      [PROVIDER_ID]: {
        baseUrl: `${backendUrl}/v1`,
        api: "openai-completions",
        apiKey: settings.apiKey || "vllm-studio",
        authHeader: Boolean(settings.apiKey),
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
        },
        models: modelsToPiModels(models),
      },
    },
  };

  const modelsPath = path.join(agentDir, "models.json");
  await writeFile(modelsPath, JSON.stringify(config, null, 2), "utf-8");
  await chmod(modelsPath, 0o600).catch(() => undefined);
  return agentDir;
}

export async function refreshPiModels(): Promise<{ models: AgentModel[]; agentDir: string }> {
  const settings = await getApiSettings();
  const models = await fetchModelsFromBackend(settings);
  const agentDir = await writePiModelsConfig(settings, models);
  return { models, agentDir };
}

class PiRpcSession extends EventEmitter {
  private process: ChildProcessWithoutNullStreams | null = null;
  private buffer = "";
  private commandSeq = 0;
  private pending = new Map<string, PendingCommand>();
  private starting: Promise<void> | null = null;
  private currentModelId = "";
  private currentCwd = "";
  private currentPiSessionId: string | null = null;
  private agentDir = "";
  private eventSeq = 0;
  private eventLog: LoggedPiEvent[] = [];
  private activePromptCount = 0;
  private lastError: string | null = null;

  private currentPluginFingerprint = "";

  async ensureStarted(
    modelId: string,
    cwd?: string,
    piSessionId?: string | null,
    options: RuntimeStartOptions = {},
  ): Promise<void> {
    const resolvedCwd = await resolveAgentCwd(cwd);
    const desiredSessionId = piSessionId ?? null;
    const desiredPluginFingerprint = pluginFingerprint(options);
    const matches =
      this.process &&
      !this.process.killed &&
      this.currentModelId === modelId &&
      this.currentCwd === resolvedCwd &&
      this.currentPiSessionId === desiredSessionId &&
      this.currentPluginFingerprint === desiredPluginFingerprint;
    if (matches) return;

    if (this.starting) await this.starting;
    const matchesAfter =
      this.process &&
      !this.process.killed &&
      this.currentModelId === modelId &&
      this.currentCwd === resolvedCwd &&
      this.currentPiSessionId === desiredSessionId &&
      this.currentPluginFingerprint === desiredPluginFingerprint;
    if (matchesAfter) return;

    this.starting = this.start(modelId, resolvedCwd, desiredSessionId, options).finally(() => {
      this.starting = null;
    });
    await this.starting;
  }

  private async start(
    modelId: string,
    cwd: string,
    piSessionId: string | null,
    options: RuntimeStartOptions,
  ): Promise<void> {
    await this.stop();
    this.eventSeq = 0;
    this.eventLog = [];
    this.activePromptCount = 0;
    this.lastError = null;
    const { models, agentDir } = await refreshPiModels();
    const selectedModel = models.find((model) => model.id === modelId);
    if (!selectedModel) {
      throw new Error(`Model '${modelId}' is not available from /v1/models.`);
    }
    this.agentDir = agentDir;
    this.currentModelId = modelId;
    this.currentCwd = cwd;
    this.currentPiSessionId = piSessionId;
    this.currentPluginFingerprint = pluginFingerprint(options);
    const plugins = options.plugins ?? [];
    const skills = options.skills ?? [];
    const shouldLoadBrowserTool =
      options.browserToolEnabled === true ||
      plugins.some(
        (plugin) =>
          pluginNameMatches(plugin, "browser-use") || pluginNameMatches(plugin, "computer-use"),
      );

    const args = [
      "--mode",
      "rpc",
      "--provider",
      PROVIDER_ID,
      "--model",
      `${PROVIDER_ID}/${modelId}`,
    ];
    if (selectedModel.reasoning) {
      args.push("--thinking", "high");
    }
    if (piSessionId) {
      // Resume a specific pi session by UUID. Pi accepts a partial UUID and
      // resolves it within the current cwd's session directory.
      args.push("--session", piSessionId);
    }
    for (const skillPath of uniqueExistingPaths([
      ...pluginSkillPaths(plugins),
      ...selectedSkillPaths(skills),
    ])) {
      args.push("--skill", skillPath);
    }
    const mcpConfigs = pluginMcpConfigs(plugins);
    const timeoutExtensionPath = resolveTimeoutExtensionPath();
    if (timeoutExtensionPath) args.push("--extension", timeoutExtensionPath);
    if (mcpConfigs.length) {
      const mcpExtensionPath = resolveMcpExtensionPath();
      if (mcpExtensionPath) args.push("--extension", mcpExtensionPath);
    }
    if (shouldLoadBrowserTool) {
      const extensionPath = resolveBrowserExtensionPath();
      if (extensionPath) args.push("--extension", extensionPath);
    }
    launchComputerUseApp(plugins);

    const launch = resolvePiLaunchCommand();
    const child = spawn(launch.command, [...launch.argsPrefix, ...args], {
      cwd,
      env: {
        ...process.env,
        PATH: piPathEnv(),
        PI_CODING_AGENT_DIR: agentDir,
        PI_SKIP_VERSION_CHECK: "1",
        // The browser extension uses this base URL to call back into the
        // frontend's /api/agent/browser/* endpoints.
        VLLM_STUDIO_FRONTEND_BASE: process.env.VLLM_STUDIO_FRONTEND_BASE ?? deriveFrontendBase(),
        VLLM_STUDIO_MCP_PLUGIN_CONFIGS: JSON.stringify(mcpConfigs),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.process = child;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.handleStdout(chunk));
    child.stderr.on("data", (chunk: string) => {
      this.recordEvent({ type: "stderr", text: chunk });
    });
    child.on("exit", (code, signal) => {
      this.recordEvent({ type: "process_exit", code, signal });
      for (const pending of this.pending.values()) {
        pending.reject(new Error(`pi rpc exited before response (code=${code}, signal=${signal})`));
      }
      this.pending.clear();
      if (this.process === child) this.process = null;
    });

    // Give the process one tick to fail early if the binary is missing.
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(resolve, 150);
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  private handleStdout(chunk: string) {
    this.buffer += chunk;
    let newline = this.buffer.indexOf("\n");
    while (newline !== -1) {
      const raw = this.buffer.slice(0, newline).replace(/\r$/, "");
      this.buffer = this.buffer.slice(newline + 1);
      if (raw.trim()) this.handleLine(raw);
      newline = this.buffer.indexOf("\n");
    }
  }

  private handleLine(raw: string) {
    let parsed: PiResponse | PiEvent;
    try {
      parsed = JSON.parse(raw) as PiResponse | PiEvent;
    } catch {
      this.recordEvent({ type: "stdout", text: raw });
      return;
    }

    if (parsed.type === "response") {
      const response = parsed as PiResponse;
      const id = response.id;
      if (id && this.pending.has(id)) {
        const pending = this.pending.get(id);
        this.pending.delete(id);
        if (response.success === false) {
          const message =
            typeof response.error === "string"
              ? response.error
              : response.error?.message || `pi rpc command '${response.command ?? id}' failed`;
          pending?.reject(new Error(message));
        } else {
          pending?.resolve(response);
        }
        return;
      }
    }

    if (parsed.type === "session") {
      for (const key of ["id", "sessionId", "session_id"]) {
        const value = parsed[key];
        if (typeof value === "string" && value.trim()) {
          this.currentPiSessionId = value.trim();
          break;
        }
      }
    }

    this.recordEvent(parsed);
  }

  private recordEvent(event: PiEvent) {
    const logged: LoggedPiEvent = {
      seq: ++this.eventSeq,
      event,
      timestamp: new Date().toISOString(),
    };
    this.eventLog.push(logged);
    if (this.eventLog.length > 2_000) this.eventLog.splice(0, this.eventLog.length - 2_000);
    this.emit("loggedEvent", logged);
    this.emit("event", event);
  }

  private sendCommand(command: Record<string, unknown>): Promise<PiResponse> {
    if (!this.process || this.process.killed) {
      return Promise.reject(new Error("pi rpc session is not running"));
    }
    const id = `cmd-${++this.commandSeq}`;
    const payload = { id, ...command };
    const line = `${JSON.stringify(payload)}\n`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for pi rpc command '${String(command.type ?? id)}'`));
      }, RPC_COMMAND_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (response) => {
          clearTimeout(timeout);
          resolve(response);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
      this.process?.stdin.write(line, (error) => {
        if (error) {
          this.pending.delete(id);
          clearTimeout(timeout);
          reject(error);
        }
      });
    });
  }

  /**
   * Send a prompt and wait for `agent_end`. When the agent is already
   * streaming (e.g. another tab is talking to the same session), pass a
   * `streamingBehavior` so pi knows to queue rather than reject.
   */
  async prompt(
    message: string,
    onEvent: (event: PiEvent, seq: number) => void,
    options: { streamingBehavior?: "steer" | "followUp" } = {},
  ): Promise<void> {
    const listener = (logged: LoggedPiEvent) => onEvent(logged.event, logged.seq);
    this.on("loggedEvent", listener);
    this.activePromptCount += 1;
    this.lastError = null;
    let settleDone: (() => void) | null = null;
    let settleError: ((error: Error) => void) | null = null;
    const donePromise = new Promise<void>((resolve, reject) => {
      settleDone = resolve;
      settleError = reject;
    });
    const timeout = setTimeout(
      () => settleError?.(new Error("Timed out waiting for pi agent completion")),
      30 * 60_000,
    );
    const done = (event: PiEvent) => {
      if (isAgentEndEvent(event)) {
        clearTimeout(timeout);
        this.off("event", done);
        settleDone?.();
      }
      if (event.type === "process_exit") {
        clearTimeout(timeout);
        this.off("event", done);
        settleError?.(new Error("pi rpc process exited during turn"));
      }
    };
    // Pi RPC writes the command response before the streamed turn events. When
    // stdout delivers response + events in the same chunk, a listener installed
    // after `sendCommand()` resolves can miss `agent_end` and leave the UI
    // permanently "running" even though the JSONL has the assistant reply.
    this.on("event", done);
    try {
      const command: Record<string, unknown> = { type: "prompt", message };
      if (options.streamingBehavior) {
        command.streamingBehavior = options.streamingBehavior;
      }
      await this.sendCommand(command);
      await donePromise;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      this.activePromptCount = Math.max(0, this.activePromptCount - 1);
      clearTimeout(timeout);
      this.off("event", done);
      this.off("loggedEvent", listener);
    }
  }

  /**
   * Steering and follow-up messages are fire-and-forget — they don't kick off
   * a new agent run on their own. Pi will deliver them after the current
   * turn (or when idle) and keep emitting events through the existing
   * event subscription.
   */
  async steer(message: string): Promise<void> {
    await this.sendCommand({ type: "steer", message });
  }

  async followUp(message: string): Promise<void> {
    await this.sendCommand({ type: "follow_up", message });
  }

  adoptPiSessionId(piSessionId: string | null | undefined): void {
    const next = piSessionId?.trim();
    if (next && !this.currentPiSessionId) this.currentPiSessionId = next;
  }

  async compact(customInstructions?: string): Promise<unknown> {
    if (this.activePromptCount > 0) {
      throw new Error("Cannot compact while the agent is running.");
    }
    const response = await this.sendCommand({
      type: "compact",
      ...(customInstructions ? { customInstructions } : {}),
    });
    return response.data;
  }

  async abort(): Promise<void> {
    if (!this.process || this.process.killed) return;
    await this.sendCommand({ type: "abort" }).catch(() => undefined);
  }

  async stop(): Promise<void> {
    if (!this.process) return;
    const child = this.process;
    this.process = null;
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 500);
      child.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    if (!child.killed) child.kill("SIGKILL");
  }

  get status() {
    const running = Boolean(this.process && !this.process.killed);
    const lastTurnEvent = [...this.eventLog].reverse().find((entry) => {
      const type = String(entry.event.type ?? "");
      return (
        type === "agent_start" ||
        type === "turn_start" ||
        type === "message_start" ||
        type === "message_update" ||
        type === "message_end" ||
        type === "tool_execution_start" ||
        type === "tool_execution_update" ||
        type === "tool_execution_end" ||
        type === "turn_end" ||
        type === "agent_end" ||
        type === "process_exit"
      );
    });
    const eventLooksActive =
      running &&
      lastTurnEvent &&
      !isAgentEndEvent(lastTurnEvent.event) &&
      lastTurnEvent.event.type !== "process_exit";
    return {
      running,
      active: this.activePromptCount > 0 || Boolean(eventLooksActive),
      modelId: this.currentModelId,
      cwd: this.currentCwd,
      piSessionId: this.currentPiSessionId,
      agentDir: this.agentDir,
      eventSeq: this.eventSeq,
      lastError: this.lastError,
    };
  }

  getEventsAfter(seq: number): LoggedPiEvent[] {
    const floor = Number.isFinite(seq) ? Math.max(0, Math.trunc(seq)) : 0;
    return this.eventLog.filter((entry) => entry.seq > floor);
  }

  onLoggedEvent(listener: (event: LoggedPiEvent) => void) {
    this.on("loggedEvent", listener);
    return () => this.off("loggedEvent", listener);
  }
}

class PiRuntimeManager {
  private sessions = new Map<string, PiRpcSession>();

  getSession(sessionId = DEFAULT_SESSION_ID): PiRpcSession {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    const created = new PiRpcSession();
    this.sessions.set(sessionId, created);
    return created;
  }
}

const globalForPi = globalThis as typeof globalThis & { __vllmStudioPiRuntime?: PiRuntimeManager };

export const piRuntimeManager = globalForPi.__vllmStudioPiRuntime ?? new PiRuntimeManager();
globalForPi.__vllmStudioPiRuntime = piRuntimeManager;
