import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage, Tool, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { windowsJobCommand } from "./windows-runtime-helper";

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
  isolated?: boolean;
  startupEnvironment?: Record<string, string>;
}

export interface HttpTarget {
  transport: "http";
  url: string;
  headers?: Record<string, string>;
  authorize?: (forceRefresh: boolean) => Promise<Record<string, string>>;
  signal?: AbortSignal;
}

export type McpTarget = StdioTarget | HttpTarget;
export type McpSpawn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;
export type McpClientDependencies = {
  spawn?: McpSpawn;
  inheritedEnvironment?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  bootstrapTimeoutMs?: number;
  shutdownGraceMs?: number;
  windowsJob?: { command: string; args?: readonly string[] };
};

const CLIENT_INFO = { name: "local-studio", version: "2.0.0" };
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_SHUTDOWN_GRACE_MS = 500;
const FORCED_SHUTDOWN_TIMEOUT_MS = 2_000;
const MAX_STARTUP_BYTES = 64 * 1024;
const MAX_BOOTSTRAP_BYTES = 64 * 1024;
const POSIX_ENVIRONMENT_KEYS = new Set([
  "PATH",
  "HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
]);
const WINDOWS_ENVIRONMENT_KEYS = new Set(
  [
    ...POSIX_ENVIRONMENT_KEYS,
    "SystemRoot",
    "ComSpec",
    "PATHEXT",
    "WINDIR",
    "USERPROFILE",
    "HOMEDRIVE",
    "HOMEPATH",
    "APPDATA",
    "LOCALAPPDATA",
    "PROGRAMDATA",
    "PROGRAMFILES",
    "PROGRAMFILES(X86)",
    "ProgramW6432",
  ].map((key) => key.toLowerCase()),
);

export function stdioChildEnvironment(
  connector: Record<string, string> = {},
  inherited: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const windows = platform === "win32";
  const nodeEnvironment = inherited.NODE_ENV;
  const environment: NodeJS.ProcessEnv = {
    NODE_ENV:
      nodeEnvironment === "development" || nodeEnvironment === "test"
        ? nodeEnvironment
        : "production",
  };
  for (const [key, value] of Object.entries(inherited)) {
    const allowed = windows
      ? WINDOWS_ENVIRONMENT_KEYS.has(key.toLowerCase())
      : POSIX_ENVIRONMENT_KEYS.has(key);
    if (allowed && value !== undefined) environment[key] = value;
  }
  for (const [key, value] of Object.entries(connector)) {
    if (windows) {
      for (const existing of Object.keys(environment)) {
        if (existing.toLowerCase() === key.toLowerCase()) delete environment[existing];
      }
    }
    environment[key] = value;
  }
  return environment;
}

const combinedSignal = (
  requestSignal: AbortSignal | null | undefined,
  targetSignal: AbortSignal | undefined,
): AbortSignal | undefined => {
  if (requestSignal && targetSignal) return AbortSignal.any([requestSignal, targetSignal]);
  return requestSignal ?? targetSignal ?? undefined;
};

const authorizedFetch = (target: HttpTarget): typeof fetch =>
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

class OwnedStdioTransport implements Transport {
  readonly onmessage: Transport["onmessage"] = undefined;
  readonly onerror: Transport["onerror"] = undefined;
  readonly onclose: Transport["onclose"] = undefined;
  private child: ChildProcess | null = null;
  private readonly readBuffer = new ReadBuffer();
  private readonly platform: NodeJS.Platform;
  private readonly bootstrapTimeoutMs: number;
  private readonly shutdownGraceMs: number;
  private readonly startupPayload: string | null;
  private bootstrapChunks: Buffer[] = [];
  private bootstrapBytes = 0;
  private bootstrapComplete = false;
  private closing: Promise<void> | null = null;
  private closeNotified = false;
  private resolveBootstrap = (): void => undefined;
  private rejectBootstrap = (_error: Error): void => undefined;
  private readonly bootstrapReady: Promise<void>;

  constructor(
    private readonly target: StdioTarget,
    private readonly dependencies: McpClientDependencies,
  ) {
    this.platform = dependencies.platform ?? process.platform;
    this.bootstrapTimeoutMs = dependencies.bootstrapTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.shutdownGraceMs = dependencies.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS;
    this.startupPayload = target.startupEnvironment
      ? `${JSON.stringify({
          localStudioBootstrap: "v1",
          environment: target.startupEnvironment,
        })}\n`
      : null;
    if (this.startupPayload && Buffer.byteLength(this.startupPayload) > MAX_STARTUP_BYTES) {
      throw new Error("MCP startup data exceeds its size limit");
    }
    this.bootstrapComplete = this.startupPayload === null;
    this.bootstrapReady = new Promise<void>((resolve, reject) => {
      this.resolveBootstrap = resolve;
      this.rejectBootstrap = reject;
    });
    if (this.bootstrapComplete) this.resolveBootstrap();
  }

  async start(): Promise<void> {
    if (this.child) throw new Error("MCP transport is already started");
    const spawnProcess: McpSpawn =
      this.dependencies.spawn ??
      ((command, args, options) => spawn(command, [...args], options));
    const windowsJob =
      this.platform === "win32"
        ? (this.dependencies.windowsJob ?? windowsJobCommand())
        : null;
    const command = windowsJob?.command ?? this.target.command;
    const args = windowsJob
      ? [...(windowsJob.args ?? []), this.target.command, ...(this.target.args ?? [])]
      : (this.target.args ?? []);
    const child = spawnProcess(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: stdioChildEnvironment(
        this.startupPayload ? {} : (this.target.env ?? {}),
        this.dependencies.inheritedEnvironment,
        this.platform,
      ),
      detached: this.platform !== "win32",
      ...(this.target.cwd ? { cwd: this.target.cwd } : {}),
    });
    this.child = child;
    child.stdout?.on("data", (chunk: Buffer) => this.receive(chunk));
    child.stdout?.on("error", (error: Error) => this.fail(error));
    child.stdin?.on("error", (error: Error) => this.fail(error));
    let stderrTail = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      if (!this.startupPayload) stderrTail = `${stderrTail}${chunk.toString("utf8")}`.slice(-2_000);
    });
    const spawned = new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
      child.once("close", () => reject(new Error("MCP server exited before startup")));
    });
    child.on("error", (error: Error) => this.fail(error));
    child.on("close", () => {
      if (this.closing) return;
      const error = new Error(
        `MCP server exited${stderrTail ? `: ${stderrTail.trim().split("\n").pop()}` : ""}`,
      );
      this.fail(error);
    });
    try {
      await spawned;
      if (this.startupPayload) await this.write(this.startupPayload);
      await this.waitForBootstrap();
    } catch (error) {
      await this.close().catch(() => undefined);
      throw error;
    }
  }

  send(message: JSONRPCMessage): Promise<void> {
    if (this.closing) return Promise.reject(new Error("MCP connection is closed"));
    return this.write(serializeMessage(message));
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.notifyClose();
    const closing = this.shutdown().finally(() => {
      this.readBuffer.clear();
      this.clearBootstrap();
    });
    this.closing = closing;
    return closing;
  }

  private receive(chunk: Buffer): void {
    if (this.bootstrapComplete) {
      this.readBuffer.append(chunk);
      this.processMessages();
      return;
    }
    const newline = chunk.indexOf(10);
    const frameEnd = newline === -1 ? chunk.length : newline;
    if (this.bootstrapBytes + frameEnd > MAX_BOOTSTRAP_BYTES) {
      this.fail(new Error(`MCP server bootstrap exceeds ${MAX_BOOTSTRAP_BYTES} bytes`));
      return;
    }
    if (frameEnd > 0) {
      this.bootstrapChunks.push(chunk.subarray(0, frameEnd));
      this.bootstrapBytes += frameEnd;
    }
    if (newline === -1) return;
    const line = Buffer.concat(this.bootstrapChunks, this.bootstrapBytes).toString("utf8").trim();
    const remainder = chunk.subarray(newline + 1);
    this.clearBootstrap();
    try {
      const decoded: unknown = JSON.parse(line);
      if (
        decoded === null ||
        typeof decoded !== "object" ||
        Reflect.get(decoded, "localStudioBootstrap") !== "ready"
      ) {
        throw new Error("MCP server returned invalid bootstrap data");
      }
      this.bootstrapComplete = true;
      this.resolveBootstrap();
      if (remainder) {
        this.readBuffer.append(Buffer.from(remainder));
        this.processMessages();
      }
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private clearBootstrap(): void {
    this.bootstrapChunks = [];
    this.bootstrapBytes = 0;
  }

  private fail(error: Error): void {
    if (this.closing) return;
    this.rejectBootstrap(error);
    this.onerror?.(error);
    void this.close().catch((closeError: unknown) => {
      this.onerror?.(closeError instanceof Error ? closeError : new Error(String(closeError)));
    });
  }

  private processMessages(): void {
    while (true) {
      try {
        const message = this.readBuffer.readMessage();
        if (!message) return;
        this.onmessage?.(message);
      } catch (error) {
        this.onerror?.(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  private write(payload: string): Promise<void> {
    const input = this.child?.stdin;
    if (!input) return Promise.reject(new Error("MCP server input is unavailable"));
    return new Promise<void>((resolve, reject) => {
      input.write(payload, (error) => (error ? reject(error) : resolve()));
    });
  }

  private waitForBootstrap(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("MCP server bootstrap timed out")),
        this.bootstrapTimeoutMs,
      );
      void this.bootstrapReady.then(
        () => {
          clearTimeout(timer);
          resolve();
        },
        (error: Error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  private notifyClose(): void {
    if (this.closeNotified) return;
    this.closeNotified = true;
    this.onclose?.();
  }

  private async shutdown(): Promise<void> {
    this.child?.stdin?.end();
    if (this.treeExited()) return;
    if (this.platform === "win32") {
      if (await this.waitForTreeExit(this.shutdownGraceMs)) return;
      this.child?.kill();
      if (await this.waitForTreeExit(FORCED_SHUTDOWN_TIMEOUT_MS)) return;
      throw new Error("MCP server process tree did not exit");
    }
    await this.signalTree("SIGTERM");
    if (await this.waitForTreeExit(this.shutdownGraceMs)) return;
    await this.signalTree("SIGKILL");
    if (await this.waitForTreeExit(FORCED_SHUTDOWN_TIMEOUT_MS)) return;
    throw new Error("MCP server process tree did not exit");
  }

  private async signalTree(signal: NodeJS.Signals): Promise<void> {
    const pid = this.child?.pid;
    if (!pid) return;
    try {
      process.kill(-pid, signal);
    } catch (error) {
      if (error instanceof Error && Reflect.get(error, "code") === "ESRCH") return;
      throw error;
    }
  }

  private treeExited(): boolean {
    const child = this.child;
    const pid = child?.pid;
    if (!child || !pid || this.platform === "win32") {
      return !child || child.exitCode !== null || child.signalCode !== null;
    }
    try {
      process.kill(-pid, 0);
      return false;
    } catch (error) {
      return error instanceof Error && Reflect.get(error, "code") === "ESRCH";
    }
  }

  private async waitForTreeExit(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (!this.treeExited() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return this.treeExited();
  }
}

const transportFor = (
  target: McpTarget,
  dependencies: McpClientDependencies,
): { transport: Transport; signal: AbortSignal | undefined } =>
  target.transport === "stdio"
    ? { transport: new OwnedStdioTransport(target, dependencies), signal: undefined }
    : {
        transport: new StreamableHTTPClientTransport(new URL(target.url), {
          requestInit: { headers: target.headers ?? {} },
          fetch: authorizedFetch(target),
        }),
        signal: target.signal,
      };

class SdkMcpConnection implements McpConnection {
  private readonly client = new Client(CLIENT_INFO, { capabilities: {} });
  private readonly connected: Promise<void>;
  private readonly signal: AbortSignal | undefined;

  constructor(target: McpTarget, dependencies: McpClientDependencies) {
    const connection = transportFor(target, dependencies);
    this.signal = connection.signal;
    this.connected = this.client.connect(connection.transport, { signal: this.signal });
  }

  async listTools(): Promise<McpToolInfo[]> {
    await this.connected;
    const result = await this.client.listTools({}, { signal: this.signal });
    return result.tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    await this.connected;
    return this.client.callTool(
      { name, arguments: args },
      undefined,
      { signal: this.signal },
    );
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

export const connectMcp = (
  target: McpTarget,
  dependencies: McpClientDependencies = {},
): McpConnection => new SdkMcpConnection(target, dependencies);
