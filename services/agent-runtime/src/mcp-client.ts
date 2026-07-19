import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  JSONRPCMessageSchema,
  type JSONRPCMessage,
  type Tool,
  type ToolAnnotations,
} from "@modelcontextprotocol/sdk/types.js";
import {
  MAX_MCP_STDIO_FRAME_BYTES,
  McpProtocolError,
  StdioJsonLineFramer,
} from "./stdio-json-line-framer";
import { windowsJobCommand } from "./windows-runtime-helper";

export { McpProtocolError } from "./stdio-json-line-framer";

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
const STDOUT_DRAIN_TIMEOUT_MS = 100;
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

const errorFrom = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

class TerminalFailure {
  private error: Error | null = null;
  private readonly rejectors = new Set<(error: Error) => void>();

  get current(): Error | null {
    return this.error;
  }

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

class OwnedStdioTransport implements Transport {
  readonly onmessage: Transport["onmessage"] = undefined;
  readonly onerror: Transport["onerror"] = undefined;
  readonly onclose: Transport["onclose"] = undefined;
  private child: ChildProcess | null = null;
  private readonly framer: StdioJsonLineFramer;
  private readonly platform: NodeJS.Platform;
  private readonly bootstrapTimeoutMs: number;
  private readonly shutdownGraceMs: number;
  private readonly startupPayload: string | null;
  private bootstrapComplete = false;
  private closing: Promise<void> | null = null;
  private closeNotified = false;
  private parentExited = false;
  private spawned = false;
  private spawnFailed = false;
  private stdoutDrainTimer: NodeJS.Timeout | null = null;
  private resolveBootstrap = (): void => undefined;
  private rejectBootstrap = (_error: Error): void => undefined;
  private readonly bootstrapReady: Promise<void>;
  private stderrTail = "";
  private readonly onStdoutData = (chunk: Buffer): void => this.receive(chunk);
  private readonly onStdoutError = (error: Error): void => this.fail(error);
  private readonly onStdoutEnd = (): void => this.finishOutput();
  private readonly onStdinError = (error: Error): void => this.fail(error);
  private readonly onStderrData = (chunk: Buffer): void => {
    if (!this.startupPayload) {
      this.stderrTail = `${this.stderrTail}${chunk.toString("utf8")}`.slice(-2_000);
    }
  };
  private readonly onStderrError = (error: Error): void => this.fail(error);
  private readonly onChildError = (error: Error): void => {
    if (!this.spawned) this.spawnFailed = true;
    this.fail(error);
  };
  private readonly onChildExit = (): void => {
    if (this.closing) return;
    this.parentExited = true;
    this.stdoutDrainTimer ??= setTimeout(() => this.finishOutput(), STDOUT_DRAIN_TIMEOUT_MS);
  };
  private readonly onChildClose = (): void => this.finishOutput();

  constructor(
    private readonly target: StdioTarget,
    private readonly dependencies: McpClientDependencies,
    private readonly terminal: TerminalFailure,
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
    this.framer = new StdioJsonLineFramer(
      this.bootstrapComplete ? MAX_MCP_STDIO_FRAME_BYTES : MAX_BOOTSTRAP_BYTES,
    );
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
    child.stdout?.on("data", this.onStdoutData);
    child.stdout?.on("error", this.onStdoutError);
    child.stdout?.on("end", this.onStdoutEnd);
    child.stdin?.on("error", this.onStdinError);
    child.stderr?.on("data", this.onStderrData);
    child.stderr?.on("error", this.onStderrError);
    child.on("error", this.onChildError);
    child.on("exit", this.onChildExit);
    child.on("close", this.onChildClose);
    try {
      await this.waitForSpawn(child);
      if (this.startupPayload) await this.write(this.startupPayload);
      await this.waitForBootstrap();
    } catch (error) {
      const failure = this.terminal.fail(errorFrom(error));
      await this.close().catch(() => undefined);
      throw failure;
    }
  }

  send(message: JSONRPCMessage): Promise<void> {
    const failure = this.terminal.current;
    if (failure) return Promise.reject(failure);
    if (this.closing) return Promise.reject(new Error("MCP connection is closed"));
    return this.write(serializeMessage(message)).catch((error: unknown) => {
      this.fail(errorFrom(error));
      throw this.terminal.current ?? errorFrom(error);
    });
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    const closing = Promise.withResolvers<void>();
    this.closing = closing.promise;
    this.clearDrainTimer();
    this.notifyClose();
    void this.shutdown().then(
      () => closing.resolve(),
      (error: unknown) => closing.reject(error),
    ).finally(() => {
      this.framer.clear();
      this.removeListeners();
    });
    return closing.promise;
  }

  private waitForSpawn(child: ChildProcess): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        child.off("spawn", onSpawn);
        child.off("error", onError);
        child.off("close", onClose);
      };
      const onSpawn = (): void => {
        this.spawned = true;
        cleanup();
        resolve();
      };
      const onError = (error: Error): void => {
        cleanup();
        reject(error);
      };
      const onClose = (): void => {
        cleanup();
        reject(new Error("MCP server exited before startup"));
      };
      child.once("spawn", onSpawn);
      child.once("error", onError);
      child.once("close", onClose);
    });
  }

  private receive(chunk: Buffer): void {
    try {
      this.framer.push(chunk, (frame) => this.receiveFrame(frame));
    } catch (error) {
      this.fail(errorFrom(error));
    }
  }

  private receiveFrame(frame: string): void {
    const decoded = this.decodeFrame(frame);
    const bootstrapReady =
      decoded !== null &&
      typeof decoded === "object" &&
      Object.keys(decoded).length === 1 &&
      Reflect.get(decoded, "localStudioBootstrap") === "ready";
    if (!this.bootstrapComplete) {
      if (!bootstrapReady) {
        throw new McpProtocolError(
          "unexpected-message",
          "MCP stdio message arrived before bootstrap completed",
        );
      }
      this.bootstrapComplete = true;
      this.framer.setMaxFrameBytes(MAX_MCP_STDIO_FRAME_BYTES);
      this.resolveBootstrap();
      return;
    }
    if (bootstrapReady) {
      throw new McpProtocolError(
        "unexpected-bootstrap",
        "MCP stdio bootstrap arrived outside the bootstrap phase",
      );
    }
    const message = JSONRPCMessageSchema.safeParse(decoded);
    if (!message.success) {
      throw new McpProtocolError(
        "invalid-json-rpc",
        "MCP stdio frame is not a valid JSON-RPC message",
      );
    }
    this.onmessage?.(message.data);
  }

  private decodeFrame(frame: string): unknown {
    const line = frame.trim();
    if (!line) throw new McpProtocolError("malformed-json", "MCP stdio frame is empty");
    try {
      return JSON.parse(line);
    } catch {
      throw new McpProtocolError("malformed-json", "MCP stdio frame is not valid JSON");
    }
  }

  private outputFailure(message: string): Error {
    if (this.framer.bufferedBytes) {
      return new McpProtocolError("unexpected-eof", "MCP stdio ended with an incomplete frame");
    }
    const diagnostic = this.stderrTail.trim().split("\n").pop();
    return new Error(`${message}${diagnostic ? `: ${diagnostic}` : ""}`);
  }

  private finishOutput(): void {
    if (this.closing) return;
    this.clearDrainTimer();
    this.fail(this.outputFailure(this.parentExited ? "MCP server exited" : "MCP server output ended"));
  }

  private clearDrainTimer(): void {
    if (this.stdoutDrainTimer) clearTimeout(this.stdoutDrainTimer);
    this.stdoutDrainTimer = null;
  }

  private fail(error: Error): void {
    if (this.closing) return;
    const failure = this.terminal.fail(error);
    this.rejectBootstrap(failure);
    this.onerror?.(failure);
    void this.close().catch((closeError: unknown) => {
      this.onerror?.(errorFrom(closeError));
    });
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

  private removeListeners(): void {
    const child = this.child;
    child?.stdout?.off("data", this.onStdoutData);
    child?.stdout?.off("error", this.onStdoutError);
    child?.stdout?.off("end", this.onStdoutEnd);
    child?.stdin?.off("error", this.onStdinError);
    child?.stderr?.off("data", this.onStderrData);
    child?.stderr?.off("error", this.onStderrError);
    child?.off("error", this.onChildError);
    child?.off("exit", this.onChildExit);
    child?.off("close", this.onChildClose);
  }

  private async shutdown(): Promise<void> {
    this.child?.stdin?.end();
    if (!this.parentExited && this.child?.stdout?.readableEnded) {
      await this.waitForParentExit(Math.min(this.shutdownGraceMs, 50));
    }
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
    if (this.spawnFailed) return true;
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

  private async waitForParentExit(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!this.parentExited && !this.exited() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  private exited(): boolean {
    const child = this.child;
    return !child || child.exitCode !== null || child.signalCode !== null;
  }
}

const transportFor = (
  target: McpTarget,
  dependencies: McpClientDependencies,
): {
  transport: Transport;
  signal: AbortSignal | undefined;
  terminal: TerminalFailure | null;
  owned: OwnedStdioTransport | null;
} => {
  if (target.transport === "stdio") {
    const terminal = new TerminalFailure();
    const owned = new OwnedStdioTransport(target, dependencies, terminal);
    return {
      transport: owned,
      signal: undefined,
      terminal,
      owned,
    };
  }
  return {
    transport: new StreamableHTTPClientTransport(new URL(target.url), {
      requestInit: { headers: target.headers ?? {} },
      fetch: authorizedFetch(target),
    }),
    signal: target.signal,
    terminal: null,
    owned: null,
  };
};

class SdkMcpConnection implements McpConnection {
  private readonly client = new Client(CLIENT_INFO, { capabilities: {} });
  private readonly connected: Promise<void>;
  private readonly signal: AbortSignal | undefined;
  private readonly terminal: TerminalFailure | null;
  private readonly owned: OwnedStdioTransport | null;
  private closing: Promise<void> | null = null;

  constructor(target: McpTarget, dependencies: McpClientDependencies) {
    const connection = transportFor(target, dependencies);
    this.signal = connection.signal;
    this.terminal = connection.terminal;
    this.owned = connection.owned;
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
      return this.client.callTool(
        { name, arguments: args },
        undefined,
        { signal: this.signal },
      );
    });
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.terminal?.fail(new Error("MCP connection is closed"));
    const closing = Promise.all([
      this.client.close(),
      this.owned?.close() ?? Promise.resolve(),
    ]).then(() => undefined);
    this.closing = closing;
    return closing;
  }

  private run<T>(operation: () => Promise<T>): Promise<T> {
    return this.terminal ? this.terminal.run(operation) : operation();
  }
}

export const connectMcp = (
  target: McpTarget,
  dependencies: McpClientDependencies = {},
): McpConnection => new SdkMcpConnection(target, dependencies);
