import type { ChildProcess } from "node:child_process";
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

export interface McpConnectionOptions {
  gracefulCloseMs?: number;
  forceCloseMs?: number;
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
const DEFAULT_GRACEFUL_CLOSE_MS = 500;
const DEFAULT_FORCE_CLOSE_MS = 1_000;

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

type PromiseSettlement =
  | { readonly settled: false }
  | { readonly settled: true; readonly error?: unknown };

const settleWithin = (promise: Promise<void>, timeoutMs: number): Promise<PromiseSettlement> =>
  new Promise((resolve) => {
    let settled = false;
    const finish = (result: PromiseSettlement): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => finish({ settled: false }), timeoutMs);
    timer.unref();
    void promise.then(
      () => finish({ settled: true }),
      (error) => finish({ settled: true, error }),
    );
  });

const childExited = (child: ChildProcess): boolean =>
  child.exitCode !== null || child.signalCode !== null;

const waitForChildExit = (child: ChildProcess, timeoutMs: number): Promise<boolean> => {
  if (childExited(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("close", onClose);
      resolve(exited);
    };
    const onClose = (): void => finish(true);
    const timer = setTimeout(() => finish(childExited(child)), timeoutMs);
    timer.unref();
    child.once("close", onClose);
    if (childExited(child)) finish(true);
  });
};

const stdioChild = (transport: StdioClientTransport | null): ChildProcess | null =>
  transport
    ? ((transport as unknown as { _process?: ChildProcess })._process ?? null)
    : null;

class SdkMcpConnection implements McpConnection {
  private readonly client = new Client(CLIENT_INFO, { capabilities: {} });
  private readonly connected: Promise<void>;
  private readonly signal: AbortSignal | undefined;
  private readonly stdioTransport: StdioClientTransport | null;
  private readonly gracefulCloseMs: number;
  private readonly forceCloseMs: number;
  private closing: Promise<void> | null = null;

  constructor(target: McpTarget, options: McpConnectionOptions) {
    this.signal = target.transport === "http" ? target.signal : undefined;
    const transport = transportFor(target);
    this.stdioTransport =
      target.transport === "stdio" ? (transport as StdioClientTransport) : null;
    this.gracefulCloseMs = options.gracefulCloseMs ?? DEFAULT_GRACEFUL_CLOSE_MS;
    this.forceCloseMs = options.forceCloseMs ?? DEFAULT_FORCE_CLOSE_MS;
    this.connected = this.client.connect(transport, { signal: this.signal });
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

  close(): Promise<void> {
    this.closing ??= this.closeOnce();
    return this.closing;
  }

  private async closeOnce(): Promise<void> {
    const child = stdioChild(this.stdioTransport);
    const closing = this.client.close();
    let settlement = await settleWithin(closing, this.gracefulCloseMs);
    if (!settlement.settled && child && !childExited(child)) {
      try {
        child.kill("SIGKILL");
      } catch {}
    }
    if (child && !(await waitForChildExit(child, this.forceCloseMs))) {
      throw new Error("MCP child process did not exit");
    }
    if (!settlement.settled) settlement = await settleWithin(closing, this.forceCloseMs);
    if (!settlement.settled) throw new Error("MCP connection did not close");
    if (settlement.error !== undefined) throw settlement.error;
  }
}

export const connectMcp = (
  target: McpTarget,
  options: McpConnectionOptions = {},
): McpConnection => new SdkMcpConnection(target, options);
