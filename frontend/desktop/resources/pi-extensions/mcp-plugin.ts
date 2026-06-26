import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type TSchema } from "typebox";

type McpServerConfig = {
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  tools?: {
    include?: string[];
    exclude?: string[];
    resources?: boolean;
    prompts?: boolean;
  };
};

// MCP servers can be launched from config the caller influences, so the child
// process must not inherit the host's secrets. Strip anything that looks like a
// credential from the inherited environment; servers that genuinely need a key
// receive it via their explicit `config.env`, which is applied on top.
const SENSITIVE_ENV_PATTERN = /(TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL|COOKIE|SESSION)/i;

function sanitizedParentEnv(): NodeJS.ProcessEnv {
  const safe: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (SENSITIVE_ENV_PATTERN.test(name)) continue;
    safe[name] = value;
  }
  return safe;
}

type McpPluginConfig = {
  pluginName: string;
  configPath: string;
};

type JsonRpc = {
  id?: number;
  method?: string;
  result?: unknown;
  error?: { message?: string };
};

type McpTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

type McpToolDetails = {
  plugin: string;
  server: string;
  tool: string;
  result?: unknown;
  error?: string;
  failed?: boolean;
};

type McpBridgeStatus = {
  pluginName: string;
  serverName: string;
  state: "starting" | "ready" | "failed";
  tools: string[];
  error?: string;
};

const DEFAULT_TOOL_TIMEOUT_MS = 120_000;
const bridgeStatuses: McpBridgeStatus[] = [];

function readTimeoutMs(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

const TOOL_TIMEOUT_MS = readTimeoutMs("LOCAL_STUDIO_MCP_TOOL_TIMEOUT_MS", DEFAULT_TOOL_TIMEOUT_MS);
// Startup must tolerate a cold `npx -y <pkg>` / `uvx` download on first launch,
// which routinely takes longer than a few seconds. Configurable so a slow link
// can raise it further.
const STARTUP_TIMEOUT_MS = readTimeoutMs("LOCAL_STUDIO_MCP_STARTUP_TIMEOUT_MS", 20_000);

function readPluginConfigs(): McpPluginConfig[] {
  try {
    const parsed = JSON.parse(process.env.LOCAL_STUDIO_MCP_PLUGIN_CONFIGS || "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const record = entry as Record<string, unknown>;
      const configPath = typeof record.configPath === "string" ? record.configPath : "";
      if (!configPath || !existsSync(configPath)) return [];
      return [
        {
          pluginName: String(record.pluginName || path.basename(path.dirname(configPath))),
          configPath,
        },
      ];
    });
  } catch {
    return [];
  }
}

function safeToolName(serverName: string, toolName: string): string {
  const raw = toolName.startsWith(`${serverName}_`) ? toolName : `${serverName}_${toolName}`;
  return raw.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

function schemaForTool(schema: Record<string, unknown> | undefined): TSchema {
  if (!schema || typeof schema !== "object") return Type.Object({});
  return Type.Unsafe(schema);
}

function contentToText(value: unknown): string {
  if (!value || typeof value !== "object") return JSON.stringify(value);
  const result = value as { content?: Array<Record<string, unknown>> };
  if (!Array.isArray(result.content)) return JSON.stringify(value, null, 2);
  return result.content
    .map((item) => {
      if (typeof item.text === "string") return item.text;
      return JSON.stringify(item);
    })
    .join("\n");
}

class McpClient {
  private child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private buffer = Buffer.alloc(0);
  private stderr = "";
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  constructor(
    readonly name: string,
    config: McpServerConfig,
    baseDir: string,
    readonly onFailure?: (message: string) => void,
  ) {
    // Resolve cwd "." (or any relative cwd) against the .mcp.json's own dir,
    // then resolve path-like commands against that cwd. Bare PATH executables
    // (e.g. "node", no separator) and absolute commands stay as-is.
    const cwd = path.resolve(baseDir, expandHome(config.cwd || "."));
    const command = resolveServerCommand(config.command ?? "", cwd);
    this.child = spawn(command, config.args ?? [], {
      cwd,
      env: { ...sanitizedParentEnv(), ...(config.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout.on("data", (chunk: Buffer) => this.onData(chunk));
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.stderr = `${this.stderr}${chunk.toString("utf8")}`.slice(-4000);
    });
    this.child.on("error", (error) => {
      this.onFailure?.(error.message);
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });
    this.child.on("exit", (code, signal) => {
      const detail = [
        `${name} MCP server exited`,
        code === null ? null : `code=${code}`,
        signal ? `signal=${signal}` : null,
        this.stderr.trim() ? `stderr=${this.stderr.trim()}` : null,
      ]
        .filter(Boolean)
        .join("; ");
      this.onFailure?.(detail);
      for (const pending of this.pending.values()) pending.reject(new Error(detail));
      this.pending.clear();
    });
  }

  async init(): Promise<McpTool[]> {
    await this.request(
      "initialize",
      {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "local-studio", version: "0.1.0" },
      },
      STARTUP_TIMEOUT_MS,
    );
    this.notify("notifications/initialized", {});
    const listed = (await this.request("tools/list", {}, STARTUP_TIMEOUT_MS)) as {
      tools?: McpTool[];
    };
    return Array.isArray(listed.tools) ? listed.tools : [];
  }

  callTool(
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal | undefined,
  ): Promise<unknown> {
    return this.request("tools/call", { name, arguments: args }, TOOL_TIMEOUT_MS, signal);
  }

  dispose() {
    if (!this.child.killed) this.child.kill("SIGTERM");
  }

  private request(
    method: string,
    params: unknown,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const id = this.nextId++;
    const payload = { jsonrpc: "2.0", id, method, params };
    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${this.name} MCP ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      const abort = () => {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error(`${this.name} MCP ${method} aborted`));
      };
      signal?.addEventListener("abort", abort, { once: true });
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
          reject(error);
        },
      });
    });
    this.write(payload);
    return promise;
  }

  private notify(method: string, params: unknown) {
    this.write({ jsonrpc: "2.0", method, params });
  }

  private write(payload: unknown) {
    const body = Buffer.from(JSON.stringify(payload), "utf8");
    this.child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    this.child.stdin.write(body);
  }

  private onData(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = this.buffer.slice(0, headerEnd).toString("utf8");
      const length = Number(/content-length:\s*(\d+)/i.exec(header)?.[1]);
      if (!Number.isFinite(length)) {
        this.buffer = Buffer.alloc(0);
        return;
      }
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + length;
      if (this.buffer.length < bodyEnd) return;
      const body = this.buffer.slice(bodyStart, bodyEnd).toString("utf8");
      this.buffer = this.buffer.slice(bodyEnd);
      this.handleMessage(body);
    }
  }

  private handleMessage(body: string) {
    let message: JsonRpc;
    try {
      message = JSON.parse(body) as JsonRpc;
    } catch {
      return;
    }
    if (typeof message.id !== "number") return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error) pending.reject(new Error(message.error.message || `${this.name} MCP error`));
    else pending.resolve(message.result);
  }
}

// Resolve a server command string against the MCP config's directory. Absolute
// paths pass through. Explicitly-relative ("./", "../") or path-bearing commands
// (contain a separator, e.g. "Codex Computer Use.app/.../SkyComputerUseClient")
// resolve against `cwd`. A bare token with no separator ("node", "uvx") is a
// PATH lookup and is left untouched for the OS to resolve.
function resolveServerCommand(command: string, cwd: string): string {
  if (!command || path.isAbsolute(command)) return command;
  const isPathLike =
    command.startsWith("./") ||
    command.startsWith("../") ||
    command.includes("/") ||
    command.includes(path.sep);
  return isPathLike ? path.resolve(cwd, command) : command;
}

function expandHome(value: string): string {
  if (value === "~") return process.env.HOME || value;
  if (value.startsWith("~/")) return path.join(process.env.HOME || "~", value.slice(2));
  return value.replace(/\$\{HOME\}/g, process.env.HOME || "");
}

function filteredTools(serverConfig: McpServerConfig, tools: McpTool[]): McpTool[] {
  const selection = serverConfig.tools;
  if (!selection) return tools;
  const include = new Set(selection.include ?? []);
  const exclude = new Set(selection.exclude ?? []);
  return tools.filter((tool) => {
    if (include.size) return include.has(tool.name);
    if (exclude.has(tool.name)) return false;
    return true;
  });
}

async function registerOneServer(
  pi: ExtensionAPI,
  plugin: McpPluginConfig,
  serverName: string,
  serverConfig: McpServerConfig,
) {
  const status: McpBridgeStatus = {
    pluginName: plugin.pluginName,
    serverName,
    state: "starting",
    tools: [],
  };
  bridgeStatuses.push(status);
  const baseDir = path.dirname(plugin.configPath);
  let client: McpClient;
  let tools: McpTool[];
  try {
    client = new McpClient(serverName, serverConfig, baseDir, (message) => {
      status.state = "failed";
      status.error = message;
    });
    tools = filteredTools(serverConfig, await client.init());
    process.once("exit", () => client.dispose());
    status.state = "ready";
    status.tools = tools.map((tool) => tool.name);
  } catch (error) {
    status.state = "failed";
    status.error = error instanceof Error ? error.message : String(error);
    return;
  }
  for (const tool of tools) {
    const piToolName = safeToolName(serverName, tool.name);
    pi.registerTool<TSchema, McpToolDetails>({
      name: piToolName,
      label: `${plugin.pluginName}: ${tool.name}`,
      description:
        tool.description || `Call ${tool.name} from the ${plugin.pluginName} MCP plugin.`,
      promptSnippet: tool.description || `Call ${tool.name} from ${plugin.pluginName}`,
      parameters: schemaForTool(tool.inputSchema),
      async execute(_toolCallId, params, signal) {
        try {
          const result = await client.callTool(
            tool.name,
            params as Record<string, unknown>,
            signal,
          );
          return {
            content: [{ type: "text", text: contentToText(result) }],
            details: { plugin: plugin.pluginName, server: serverName, tool: tool.name, result },
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [
              { type: "text", text: `${plugin.pluginName}:${tool.name} failed: ${message}` },
            ],
            details: {
              plugin: plugin.pluginName,
              server: serverName,
              tool: tool.name,
              result: null,
              error: message,
              failed: true,
            },
          };
        }
      },
    });
  }
}

export default async function registerMcpPlugins(pi: ExtensionAPI) {
  pi.registerTool({
    name: "mcp_plugin_status",
    label: "MCP Plugin Status",
    description: "Report which selected Codex MCP plugins loaded, failed, and exposed tools.",
    promptSnippet: "Inspect selected Codex MCP plugin runtime status",
    parameters: Type.Object({}),
    async execute() {
      const text =
        bridgeStatuses
          .map((status) => {
            const tools = status.tools.length ? status.tools.join(", ") : "no tools";
            const error = status.error ? `; error: ${status.error}` : "";
            return `${status.pluginName}/${status.serverName}: ${status.state}; ${tools}${error}`;
          })
          .join("\n") || "No MCP plugin servers configured.";
      return {
        content: [{ type: "text", text }],
        details: { statuses: bridgeStatuses },
      };
    },
  });
  const registrations: Promise<void>[] = [];
  for (const plugin of readPluginConfigs()) {
    let servers: Record<string, McpServerConfig> = {};
    try {
      servers =
        (
          JSON.parse(readFileSync(plugin.configPath, "utf8")) as {
            mcpServers?: Record<string, McpServerConfig>;
          }
        ).mcpServers ?? {};
    } catch {
      continue;
    }
    for (const [serverName, serverConfig] of Object.entries(servers)) {
      if (!serverConfig.command) continue;
      registrations.push(registerOneServer(pi, plugin, serverName, serverConfig));
    }
  }
  await Promise.all(registrations);
}
