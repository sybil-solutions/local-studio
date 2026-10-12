import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { Tool, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { BoundedStdioClientTransport } from "./mcp-stdio-transport";

export { McpProtocolError } from "./mcp-stdio-transport";

export type McpToolAnnotations = ToolAnnotations;
export type McpToolInfo = Tool;

export interface McpConnection {
  listTools(): Promise<McpToolInfo[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): void;
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

// MCP children get a minimal environment, not this process's: the runtime's
// env carries controller keys, OAuth client secrets, and session tokens that
// no third-party server package has any business reading. A connector that
// needs a value declares it in target.env.
const INHERITED_ENV_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "TERM",
  // Windows process bootstrap requires these.
  "SYSTEMROOT",
  "SystemRoot",
  "COMSPEC",
  "APPDATA",
  "LOCALAPPDATA",
  "USERPROFILE",
  "TEMP",
  "TMP",
] as const;

const processEnvironment = (): Record<string, string> =>
  Object.fromEntries(
    INHERITED_ENV_KEYS.flatMap((key) => {
      const value = process.env[key];
      return value === undefined ? [] : [[key, value] as [string, string]];
    }),
  );

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

const errorFrom = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

class TerminalFailure {
  private error: Error | null = null;
  private readonly rejectors = new Set<(error: Error) => void>();

  run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.error) return Promise.reject(this.error);
    return new Promise<T>((resolve, reject) => {
      const rejectTerminal = (error: Error): void => {
        this.rejectors.delete(rejectTerminal);
        reject(error);
      };
      this.rejectors.add(rejectTerminal);
      let pending: Promise<T>;
      try {
        pending = operation();
      } catch (error) {
        this.rejectors.delete(rejectTerminal);
        reject(errorFrom(error));
        return;
      }
      void pending.then(
        (value) => {
          this.rejectors.delete(rejectTerminal);
          resolve(value);
        },
        (error: unknown) => {
          this.rejectors.delete(rejectTerminal);
          reject(error);
        },
      );
    });
  }

  fail(error: Error): Error {
    if (this.error) return this.error;
    this.error = error;
    for (const reject of this.rejectors) reject(error);
    this.rejectors.clear();
    return error;
  }
}

const transportFor = (
  target: McpTarget,
): { transport: Transport; terminal: TerminalFailure | null } => {
  if (target.transport === "stdio") {
    const terminal = new TerminalFailure();
    return {
      transport: new BoundedStdioClientTransport(
        {
          command: target.command,
          args: target.args ?? [],
          env: { ...processEnvironment(), ...(target.env ?? {}) },
          ...(target.cwd ? { cwd: target.cwd } : {}),
          stderr: "pipe",
        },
        (error) => terminal.fail(error),
      ),
      terminal,
    };
  }
  return {
    transport: new StreamableHTTPClientTransport(new URL(target.url), {
      requestInit: { headers: target.headers ?? {} },
      fetch: authorizedFetch(target),
    }),
    terminal: null,
  };
};

class SdkMcpConnection implements McpConnection {
  private readonly client = new Client(CLIENT_INFO, { capabilities: {} });
  private readonly connected: Promise<void>;
  private readonly signal: AbortSignal | undefined;
  private readonly terminal: TerminalFailure | null;
  private closed = false;

  constructor(target: McpTarget) {
    const connection = transportFor(target);
    this.signal = target.transport === "http" ? target.signal : undefined;
    this.terminal = connection.terminal;
    this.connected = this.run(() =>
      this.client.connect(connection.transport, { signal: this.signal }),
    );
  }

  listTools(): Promise<McpToolInfo[]> {
    return this.run(async () => {
      await this.connected;
      const result = await this.client.listTools({}, { signal: this.signal });
      return result.tools;
    });
  }

  callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.run(async () => {
      await this.connected;
      return this.client.callTool({ name, arguments: args }, undefined, { signal: this.signal });
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.terminal?.fail(new Error("MCP connection is closed"));
    void this.client.close().catch(() => undefined);
  }

  private run<T>(operation: () => Promise<T>): Promise<T> {
    return this.terminal ? this.terminal.run(operation) : operation();
  }
}

export const connectMcp = (target: McpTarget): McpConnection => new SdkMcpConnection(target);
