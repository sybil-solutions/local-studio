import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Tool, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

export type McpToolAnnotations = ToolAnnotations;
export type McpToolInfo = Tool;

export interface McpConnection {
  listTools(): Promise<McpToolInfo[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

export interface StdioTarget {
  transport: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface HttpTarget {
  transport: "http";
  url: string;
  headers?: Record<string, string>;
  authorize?: (forceRefresh: boolean) => Promise<Record<string, string>>;
  signal?: AbortSignal;
}

export type McpTarget = StdioTarget | HttpTarget;

const CLIENT_INFO = { name: "local-studio", version: "2.0.0" };

const POSIX_ENVIRONMENT_KEYS = [
  "PATH",
  "HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "USER",
  "LOGNAME",
  "LANG",
  "LANGUAGE",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",
];

const WINDOWS_ENVIRONMENT_KEYS = [
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
];

export function stdioChildEnvironment(
  explicit: Record<string, string> = {},
  parent: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  const windows = platform === "win32";
  const entries = Object.entries(parent).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  );
  const result: Record<string, string> = {};
  for (const key of windows ? WINDOWS_ENVIRONMENT_KEYS : POSIX_ENVIRONMENT_KEYS) {
    const found = entries.find(([name]) => (windows ? name.toUpperCase() === key : name === key));
    if (found) result[key] = found[1];
  }
  for (const [key, value] of Object.entries(explicit)) {
    if (windows) {
      const duplicate = Object.keys(result).find(
        (existing) => existing.toUpperCase() === key.toUpperCase(),
      );
      if (duplicate) delete result[duplicate];
    }
    result[key] = value;
  }
  return result;
}

const combinedSignal = (
  requestSignal: AbortSignal | null | undefined,
  targetSignal: AbortSignal | undefined,
): AbortSignal | undefined => {
  if (requestSignal && targetSignal) return AbortSignal.any([requestSignal, targetSignal]);
  return requestSignal ?? targetSignal ?? undefined;
};

const authorizedFetch =
  (target: HttpTarget): typeof fetch =>
  async (input, init) => {
    const send = async (forceRefresh: boolean): Promise<Response> => {
      const headers = new Headers(init?.headers);
      const authorization = target.authorize ? await target.authorize(forceRefresh) : {};
      for (const [name, value] of Object.entries(authorization)) headers.set(name, value);
      return fetch(input, {
        ...init,
        headers,
        redirect: target.authorize ? "error" : "follow",
        signal: combinedSignal(init?.signal, target.signal),
      });
    };
    const response = await send(false);
    return response.status === 401 && target.authorize ? send(true) : response;
  };

const transportFor = (target: McpTarget) => {
  if (target.transport === "stdio") {
    return new StdioClientTransport({
      command: target.command,
      args: target.args ?? [],
      env: stdioChildEnvironment(target.env),
      ...(target.cwd ? { cwd: target.cwd } : {}),
      stderr: "pipe",
    });
  }
  return new StreamableHTTPClientTransport(new URL(target.url), {
    requestInit: { headers: target.headers ?? {} },
    fetch: authorizedFetch(target),
  });
};

class SdkMcpConnection implements McpConnection {
  private readonly client = new Client(CLIENT_INFO, { capabilities: {} });
  private readonly connected: Promise<void>;
  private readonly signal: AbortSignal | undefined;
  private readonly transport: ReturnType<typeof transportFor>;
  private readonly transportClosed: Promise<void>;
  private closing: Promise<void> | undefined;

  constructor(target: McpTarget) {
    this.signal = target.transport === "http" ? target.signal : undefined;
    this.transport = transportFor(target);
    this.transportClosed = new Promise((resolve) => {
      this.transport.onclose = resolve;
    });
    this.connected = this.client.connect(this.transport, { signal: this.signal });
  }

  async listTools(): Promise<McpToolInfo[]> {
    await this.connected;
    const result = await this.client.listTools({}, { signal: this.signal });
    return result.tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    await this.connected;
    return this.client.callTool({ name, arguments: args }, undefined, { signal: this.signal });
  }

  async close(): Promise<void> {
    if (this.closing) return this.closing;
    const waitForStdioExit =
      this.transport instanceof StdioClientTransport && this.transport.pid !== null;
    this.closing = this.client.close().then(async () => {
      if (!waitForStdioExit) return;
      await Promise.race([
        this.transportClosed,
        new Promise<never>((_, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("MCP stdio process did not exit")),
            2_000,
          );
          timeout.unref();
        }),
      ]);
    });
    return this.closing;
  }
}

export const connectMcp = (target: McpTarget): McpConnection => new SdkMcpConnection(target);
