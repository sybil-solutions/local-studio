import { spawn, type ChildProcess } from "child_process";
import { Schema } from "effect";

const McpToolAnnotationsSchema = Schema.Struct({
  destructiveHint: Schema.optional(Schema.Boolean),
  idempotentHint: Schema.optional(Schema.Boolean),
  openWorldHint: Schema.optional(Schema.Boolean),
  readOnlyHint: Schema.optional(Schema.Boolean),
});

const McpToolInfoSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  inputSchema: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  annotations: Schema.optional(McpToolAnnotationsSchema),
});

export type McpToolAnnotations = typeof McpToolAnnotationsSchema.Type;
export type McpToolInfo = typeof McpToolInfoSchema.Type;

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

const PROTOCOL_VERSION = "2025-03-26";
const CLIENT_INFO = { name: "local-studio", version: "1.0.0" };
const DEFAULT_TIMEOUT_MS = 60_000;

const JsonRpcResponseSchema = Schema.Struct({
  id: Schema.optional(Schema.Number),
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.Struct({ code: Schema.Number, message: Schema.String })),
  method: Schema.optional(Schema.String),
});

const McpToolsResultSchema = Schema.Struct({
  tools: Schema.optional(Schema.Array(McpToolInfoSchema)),
});

type JsonRpcResponse = typeof JsonRpcResponseSchema.Type;

export function stdioLaunchCommand(
  command: string,
  args: string[],
): { command: string; args: string[] } {
  if (process.platform !== "win32") return { command, args };
  return { command: process.env["ComSpec"] ?? "cmd.exe", args: ["/c", command, ...args] };
}

function killProcessTree(child: ChildProcess): void {
  if (process.platform === "win32" && child.pid) {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  child.kill("SIGTERM");
}

class StdioMcpConnection implements McpConnection {
  private child: ChildProcess;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();
  private buffer = "";
  private initialized: Promise<void>;
  private stderrTail = "";

  constructor(target: StdioTarget) {
    const launch = stdioLaunchCommand(target.command, target.args ?? []);
    this.child = spawn(launch.command, launch.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...(target.env ?? {}) },
      ...(target.cwd ? { cwd: target.cwd } : {}),
    });
    this.child.stdout?.on("data", (chunk: Buffer) => this.onData(chunk));
    this.child.stderr?.on("data", (chunk: Buffer) => {
      this.stderrTail = `${this.stderrTail}${chunk.toString("utf8")}`.slice(-2000);
    });
    this.child.on("close", () => {
      const error = new Error(
        `MCP server exited${this.stderrTail ? `: ${this.stderrTail.trim().split("\n").pop()}` : ""}`,
      );
      for (const entry of this.pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(error);
      }
      this.pending.clear();
    });
    this.initialized = this.initialize();
  }

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString("utf8");
    let newline = this.buffer.indexOf("\n");
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      newline = this.buffer.indexOf("\n");
      if (!line) continue;
      try {
        const message = Schema.decodeUnknownSync(JsonRpcResponseSchema)(JSON.parse(line));
        if (typeof message.id === "number" && this.pending.has(message.id)) {
          const entry = this.pending.get(message.id);
          if (!entry) continue;
          this.pending.delete(message.id);
          clearTimeout(entry.timer);
          if (message.error) entry.reject(new Error(message.error.message));
          else entry.resolve(message.result);
        }
      } catch {}
    }
  }

  private request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    const payload = `${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) })}\n`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request "${method}" timed out`));
      }, DEFAULT_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin?.write(payload, (error) => {
        if (error) {
          this.pending.delete(id);
          clearTimeout(timer);
          reject(error);
        }
      });
    });
  }

  private notify(method: string): void {
    this.child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
  }

  private async initialize(): Promise<void> {
    await this.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    });
    this.notify("notifications/initialized");
  }

  async listTools(): Promise<McpToolInfo[]> {
    await this.initialized;
    const result = Schema.decodeUnknownSync(McpToolsResultSchema)(
      await this.request("tools/list", {}),
    );
    return [...(result.tools ?? [])];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    await this.initialized;
    return this.request("tools/call", { name, arguments: args });
  }

  close(): void {
    killProcessTree(this.child);
  }
}

class HttpMcpConnection implements McpConnection {
  private nextId = 1;
  private sessionId: string | null = null;
  private initialized: Promise<void>;

  constructor(private target: HttpTarget) {
    this.initialized = this.initialize();
  }

  private async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const payload = {
      jsonrpc: "2.0",
      id: this.nextId++,
      method,
      ...(params ? { params } : {}),
    };
    return this.send(payload, false);
  }

  private async send(payload: Record<string, unknown>, forceRefresh: boolean): Promise<unknown> {
    const authorization = this.target.authorize ? await this.target.authorize(forceRefresh) : {};
    const timeout = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
    const response = await fetch(this.target.url, {
      method: "POST",
      redirect: this.target.authorize ? "error" : "follow",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}),
        ...(this.target.headers ?? {}),
        ...authorization,
      },
      body: JSON.stringify(payload),
      signal: this.target.signal ? AbortSignal.any([timeout, this.target.signal]) : timeout,
    });
    if (response.status === 401 && this.target.authorize && !forceRefresh) {
      return this.send(payload, true);
    }
    const session = response.headers.get("Mcp-Session-Id");
    if (session) this.sessionId = session;
    if (!response.ok) throw new Error(`MCP HTTP ${response.status}`);
    const contentType = response.headers.get("content-type") ?? "";
    let message: JsonRpcResponse;
    if (contentType.includes("text/event-stream")) {
      const text = await response.text();
      const dataLine = text
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .pop();
      if (!dataLine) throw new Error("MCP HTTP: empty event stream response");
      message = Schema.decodeUnknownSync(JsonRpcResponseSchema)(
        JSON.parse(dataLine.slice(5).trim()),
      );
    } else {
      message = Schema.decodeUnknownSync(JsonRpcResponseSchema)(await response.json());
    }
    if (message.error) throw new Error(message.error.message);
    return message.result;
  }

  private async initialize(): Promise<void> {
    await this.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    });
  }

  async listTools(): Promise<McpToolInfo[]> {
    await this.initialized;
    const result = Schema.decodeUnknownSync(McpToolsResultSchema)(
      await this.request("tools/list", {}),
    );
    return [...(result.tools ?? [])];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    await this.initialized;
    return this.request("tools/call", { name, arguments: args });
  }

  close(): void {}
}

export const connectMcp = (target: McpTarget): McpConnection =>
  target.transport === "stdio" ? new StdioMcpConnection(target) : new HttpMcpConnection(target);
