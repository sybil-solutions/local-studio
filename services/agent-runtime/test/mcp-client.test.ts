import { describe, expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  connectMcp,
  McpProtocolError,
  stdioChildEnvironment,
  type McpConnection,
  type McpSpawn,
} from "../src/mcp-client";
import { MAX_MCP_STDIO_FRAME_BYTES } from "../src/stdio-json-line-framer";

const stdioFixture = path.join(import.meta.dir, "fixtures", "mcp-stdio-server.mjs");

type FramingFixture = {
  child: () => ChildProcess;
  connection: McpConnection;
};

function framingFixture(
  mode: string,
  options: { command?: string; startupEnvironment?: Record<string, string> } = {},
): FramingFixture {
  let child: ChildProcess | null = null;
  const spawnProcess: McpSpawn = (command, args, spawnOptions) => {
    child = spawn(command, args, spawnOptions);
    return child;
  };
  return {
    child: () => {
      if (!child) throw new Error("MCP fixture did not spawn");
      return child;
    },
    connection: connectMcp(
      {
        transport: "stdio",
        command: options.command ?? process.execPath,
        args: [stdioFixture, mode, String(MAX_MCP_STDIO_FRAME_BYTES)],
        ...(options.startupEnvironment ? { startupEnvironment: options.startupEnvironment } : {}),
      },
      { spawn: spawnProcess, shutdownGraceMs: 50 },
    ),
  };
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

async function closeFramingFixture(fixture: FramingFixture): Promise<void> {
  const child = fixture.child();
  const closing = fixture.connection.close();
  expect(fixture.connection.close()).toBe(closing);
  await closing;
  const pid = child.pid;
  if (pid) expect(processExists(pid)).toBe(false);
  expect(child.listenerCount("error")).toBe(0);
  expect(child.listenerCount("exit")).toBe(0);
  expect(child.listenerCount("close")).toBe(0);
  expect(child.stdin?.listenerCount("error") ?? 0).toBe(0);
  expect(child.stdout?.listenerCount("data") ?? 0).toBe(0);
  expect(child.stdout?.listenerCount("error") ?? 0).toBe(0);
  expect(child.stdout?.listenerCount("end") ?? 0).toBe(0);
  expect(child.stderr?.listenerCount("data") ?? 0).toBe(0);
  expect(child.stderr?.listenerCount("error") ?? 0).toBe(0);
}

async function bootstrapFailure(
  source: string,
  options: { bootstrapTimeoutMs?: number; expectDescendant?: boolean } = {},
): Promise<Error> {
  let child: ChildProcess | null = null;
  let descendantPid = 0;
  const spawnProcess: McpSpawn = (command, args, spawnOptions) => {
    child = spawn(command, args, spawnOptions);
    child.stderr?.on("data", (chunk: Buffer) => {
      const match = /descendant=(\d+)/.exec(chunk.toString("utf8"));
      if (match?.[1]) descendantPid = Number(match[1]);
    });
    return child;
  };
  const connection = connectMcp(
    {
      transport: "stdio",
      command: process.execPath,
      args: ["-e", source],
      startupEnvironment: { CONNECTOR_TOKEN: "isolated" },
    },
    {
      spawn: spawnProcess,
      shutdownGraceMs: 50,
      ...(options.bootstrapTimeoutMs === undefined
        ? {}
        : { bootstrapTimeoutMs: options.bootstrapTimeoutMs }),
    },
  );
  const outcome = await Promise.race([
    connection.listTools().then(
      () => null,
      (error: unknown) => error,
    ),
    new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 5_000)),
  ]);
  expect(outcome).not.toBe("timeout");
  expect(outcome).toBeInstanceOf(Error);
  await connection.close();
  const pid = child?.pid;
  if (pid) {
    expect(processExists(pid)).toBe(false);
    if (process.platform !== "win32") expect(processGroupExists(pid)).toBe(false);
  }
  if (options.expectDescendant) {
    expect(descendantPid).toBeGreaterThan(0);
    expect(processExists(descendantPid)).toBe(false);
  }
  if (!(outcome instanceof Error)) throw new Error("Expected bootstrap failure");
  return outcome;
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function processGroupExists(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stopProcess(pid: number): Promise<void> {
  if (!processExists(pid)) return;
  try {
    process.kill(pid, "SIGKILL");
  } catch {}
}

async function windowsJobFixture(): Promise<{ helper: string; root: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "local-studio-windows-job-"));
  const helper = path.join(root, "job-helper.mjs");
  await writeFile(
    helper,
    [
      "import { spawn } from 'node:child_process'",
      "const separator = process.argv.indexOf('run-job')",
      "const command = process.argv[separator + 1]",
      "const args = process.argv.slice(separator + 2)",
      "const child = spawn(command, args, { detached: true, stdio: ['pipe', 'pipe', 'pipe'] })",
      "process.stdin.pipe(child.stdin)",
      "child.stdout.pipe(process.stdout)",
      "child.stderr.pipe(process.stderr)",
      "const groupExists = () => { try { process.kill(-child.pid, 0); return true } catch { return false } }",
      "const finish = () => { if (!groupExists()) process.exit(0) }",
      "const timer = setInterval(finish, 10)",
      "process.on('SIGTERM', () => { try { process.kill(-child.pid, 'SIGKILL') } catch {}; clearInterval(timer); process.exit(0) })",
    ].join("\n"),
  );
  await chmod(helper, 0o700);
  return { helper, root };
}

describe("stdio MCP child environment", () => {
  test("inherits only the POSIX runtime essentials and explicit connector variables", () => {
    expect(
      stdioChildEnvironment(
        { CONNECTOR_TOKEN: "connector-secret", PATH: "/connector/bin" },
        {
          PATH: "/usr/bin",
          HOME: "/safe-home",
          TMPDIR: "/safe-tmp",
          LANG: "C.UTF-8",
          SHELL: "/bin/zsh",
          USER: "operator",
          OPENAI_API_KEY: "ambient-secret",
          AWS_SECRET_ACCESS_KEY: "ambient-cloud-secret",
        },
        "linux",
      ),
    ).toEqual({
      NODE_ENV: "production",
      PATH: "/connector/bin",
      HOME: "/safe-home",
      TMPDIR: "/safe-tmp",
      LANG: "C.UTF-8",
      CONNECTOR_TOKEN: "connector-secret",
    });
  });

  test("preserves Windows process essentials without ambient credentials", () => {
    expect(
      stdioChildEnvironment(
        { PATH: "C:\\connector", CONNECTOR_TOKEN: "connector-secret" },
        {
          Path: "C:\\Windows\\System32",
          SystemRoot: "C:\\Windows",
          ComSpec: "C:\\Windows\\System32\\cmd.exe",
          TEMP: "C:\\Temp",
          USERPROFILE: "C:\\Users\\operator",
          AZURE_CLIENT_SECRET: "ambient-cloud-secret",
        },
        "win32",
      ),
    ).toEqual({
      NODE_ENV: "production",
      PATH: "C:\\connector",
      SystemRoot: "C:\\Windows",
      ComSpec: "C:\\Windows\\System32\\cmd.exe",
      TEMP: "C:\\Temp",
      USERPROFILE: "C:\\Users\\operator",
      CONNECTOR_TOKEN: "connector-secret",
    });
  });

  test("passes the filtered environment to the spawned MCP process", async () => {
    let spawnCount = 0;
    const spawnProcess: McpSpawn = (command, args, options) => {
      spawnCount += 1;
      return spawn(command, args, options);
    };
    const source = [
      "const readline = require('node:readline')",
      "const lines = readline.createInterface({ input: process.stdin })",
      "lines.on('line', (line) => {",
      "const message = JSON.parse(line)",
      "if (message.id === undefined) return",
      "const tools = process.env.CONNECTOR_TOKEN === 'explicit' && !process.env.PARENT_SENTINEL ? [{ name: 'filtered', inputSchema: { type: 'object' } }] : [{ name: 'leaked', inputSchema: { type: 'object' } }]",
      "const result = message.method === 'initialize' ? { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'fixture', version: '1.0.0' } } : message.method === 'tools/list' ? { tools } : {}",
      "process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\\n')",
      "})",
    ].join("\n");
    const connection = connectMcp(
      {
        transport: "stdio",
        command: process.execPath,
        args: ["-e", source],
        env: { CONNECTOR_TOKEN: "explicit" },
      },
      {
        spawn: spawnProcess,
        inheritedEnvironment: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          PARENT_SENTINEL: "ambient-secret",
        },
        platform: process.platform,
      },
    );
    try {
      expect((await connection.listTools()).map((tool) => tool.name)).toEqual(["filtered"]);
      expect(spawnCount).toBe(1);
    } finally {
      await connection.close();
    }
  });

  test("delivers connector data over the owned pipe after process startup", async () => {
    const secret = "pipe-only-connector-secret";
    let spawnedEnvironment = "";
    const spawnProcess: McpSpawn = (command, args, options) => {
      spawnedEnvironment = JSON.stringify(options.env);
      return spawn(command, args, options);
    };
    const source = [
      "let buffer = ''",
      "let bootstrapped = false",
      "process.stdin.setEncoding('utf8')",
      "process.stdin.on('data', (chunk) => {",
      "buffer += chunk",
      "let newline = buffer.indexOf('\\n')",
      "while (newline !== -1) {",
      "const line = buffer.slice(0, newline)",
      "buffer = buffer.slice(newline + 1)",
      "newline = buffer.indexOf('\\n')",
      "const message = JSON.parse(line)",
      "if (!bootstrapped) {",
      "Object.assign(process.env, message.environment)",
      "bootstrapped = true",
      "process.stdout.write(JSON.stringify({ localStudioBootstrap: 'ready' }) + '\\n')",
      "continue",
      "}",
      "if (message.id === undefined) continue",
      "const tools = process.env.CONNECTOR_TOKEN === 'pipe-only-connector-secret' ? [{ name: 'isolated', inputSchema: { type: 'object' } }] : [{ name: 'missing', inputSchema: { type: 'object' } }]",
      "const result = message.method === 'initialize' ? { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'fixture', version: '1.0.0' } } : message.method === 'tools/list' ? { tools } : {}",
      "process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\\n')",
      "}",
      "})",
    ].join("\n");
    const connection = connectMcp(
      {
        transport: "stdio",
        command: process.execPath,
        args: ["-e", source],
        startupEnvironment: { CONNECTOR_TOKEN: secret },
      },
      { spawn: spawnProcess },
    );
    try {
      expect((await connection.listTools()).map((tool) => tool.name)).toEqual(["isolated"]);
      expect(spawnedEnvironment).not.toContain(secret);
      expect(spawnedEnvironment).not.toContain("CONNECTOR_TOKEN");
    } finally {
      await connection.close();
    }
  });

  test("rejects and terminates an oversized bootstrap response without a newline", async () => {
    const failure = await bootstrapFailure(
      [
        "const { spawn } = require('node:child_process')",
        "const descendant = spawn(process.execPath, ['-e', 'setInterval(() => undefined, 1000)'], { stdio: 'ignore' })",
        "process.stdin.once('data', () => process.stderr.write(`descendant=${descendant.pid}\\n`, () => process.stdout.write(Buffer.alloc(65 * 1024, 97))))",
        "setInterval(() => undefined, 1000)",
      ].join("\n"),
      { expectDescendant: true },
    );
    expect(failure.message).toContain("frame exceeds 65536 bytes");
  });

  test("rejects and terminates an invalid bootstrap acknowledgement", async () => {
    const failure = await bootstrapFailure(
      [
        "process.stdin.once('data', () => process.stdout.write('{\"localStudioBootstrap\":\"invalid\"}\\n'))",
        "setInterval(() => undefined, 1000)",
      ].join("\n"),
    );
    expect(failure.message).toContain("before bootstrap completed");
  });

  test("times out a silent bootstrap and terminates its process tree", async () => {
    const failure = await bootstrapFailure(
      [
        "const { spawn } = require('node:child_process')",
        "const descendant = spawn(process.execPath, ['-e', 'setInterval(() => undefined, 1000)'], { stdio: 'ignore' })",
        "process.stderr.write(`descendant=${descendant.pid}\\n`)",
        "setInterval(() => undefined, 1000)",
      ].join("\n"),
      { bootstrapTimeoutMs: 25, expectDescendant: true },
    );
    expect(failure.message).toContain("bootstrap timed out");
  });

  test("does not expose startup data through process diagnostics", async () => {
    const secret = "diagnostic-secret-value";
    const source = [
      "let bootstrapped = false",
      "process.stdin.setEncoding('utf8')",
      "process.stdin.on('data', (chunk) => {",
      "const message = JSON.parse(chunk.trim())",
      "if (!bootstrapped) {",
      "bootstrapped = true",
      "process.stdout.write(JSON.stringify({ localStudioBootstrap: 'ready' }) + '\\n')",
      "return",
      "}",
      `process.stderr.write(${JSON.stringify(secret)} + '\\n')`,
      "process.exit(1)",
      "})",
    ].join("\n");
    const connection = connectMcp({
      transport: "stdio",
      command: process.execPath,
      args: ["-e", source],
      startupEnvironment: { CONNECTOR_TOKEN: secret },
    });
    let diagnostic = "";
    try {
      await connection.listTools();
    } catch (error) {
      diagnostic = error instanceof Error ? error.message : String(error);
    } finally {
      await connection.close();
    }
    expect(diagnostic).not.toContain(secret);
  });

  test("rejects pending I/O and confirms termination of an uncooperative process tree", async () => {
    const descendant = ["process.on('SIGTERM', () => {})", "setInterval(() => {}, 1000)"].join(
      "\n",
    );
    const source = [
      "const { spawn } = require('node:child_process')",
      `const descendant = spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: 'ignore' })`,
      "let buffer = ''",
      "process.stdin.setEncoding('utf8')",
      "process.stdin.on('data', (chunk) => {",
      "buffer += chunk",
      "let newline = buffer.indexOf('\\n')",
      "while (newline !== -1) {",
      "const line = buffer.slice(0, newline)",
      "buffer = buffer.slice(newline + 1)",
      "newline = buffer.indexOf('\\n')",
      "const message = JSON.parse(line)",
      "if (message.id === undefined) continue",
      "if (message.method === 'tools/call') continue",
      "const result = message.method === 'initialize' ? { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'fixture', version: '1.0.0' } } : message.method === 'tools/list' ? { tools: [{ name: `${process.pid}:${descendant.pid}`, inputSchema: { type: 'object' } }] } : {}",
      "process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\\n')",
      "}",
      "})",
    ].join("\n");
    const connection = connectMcp(
      { transport: "stdio", command: process.execPath, args: ["-e", source] },
      { shutdownGraceMs: 50 },
    );
    const [parentPid, descendantPid] = (await connection.listTools())[0]?.name
      .split(":")
      .map(Number) ?? [0, 0];
    const pending = connection.callTool("hang", {});
    await new Promise((resolve) => setTimeout(resolve, 20));
    try {
      const closing = connection.close();
      const pendingOutcome = await Promise.race([
        pending.then(
          () => "resolved",
          () => "rejected",
        ),
        new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 200)),
      ]);
      expect(pendingOutcome).toBe("rejected");
      await closing;
      expect(processExists(parentPid)).toBe(false);
      expect(processExists(descendantPid)).toBe(false);
    } finally {
      await stopProcess(parentPid);
      await stopProcess(descendantPid);
    }
  });

  test("owns Windows descendants after the direct MCP parent exits and forces a hung job", async () => {
    const { helper, root } = await windowsJobFixture();
    const descendant = ["process.on('SIGTERM', () => {})", "setInterval(() => {}, 1000)"].join(
      "\n",
    );
    const source = [
      "const { spawn } = require('node:child_process')",
      `const descendant = spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: 'ignore' })`,
      "let buffer = ''",
      "process.stdin.setEncoding('utf8')",
      "process.stdin.on('data', (chunk) => {",
      "buffer += chunk",
      "let newline = buffer.indexOf('\\n')",
      "while (newline !== -1) {",
      "const line = buffer.slice(0, newline)",
      "buffer = buffer.slice(newline + 1)",
      "newline = buffer.indexOf('\\n')",
      "const message = JSON.parse(line)",
      "if (message.id === undefined) continue",
      "const result = message.method === 'initialize' ? { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'fixture', version: '1.0.0' } } : message.method === 'tools/list' ? { tools: [{ name: `${process.pid}:${descendant.pid}`, inputSchema: { type: 'object' } }] } : {}",
      "process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\\n', () => { if (message.method === 'tools/list') process.exit(0) })",
      "}",
      "})",
    ].join("\n");
    const connection = connectMcp(
      { transport: "stdio", command: process.execPath, args: ["-e", source] },
      {
        platform: "win32",
        shutdownGraceMs: 30,
        windowsJob: { command: process.execPath, args: [helper, "run-job"] },
      },
    );
    const [parentPid, descendantPid] = (await connection.listTools())[0]?.name
      .split(":")
      .map(Number) ?? [0, 0];
    await new Promise((resolve) => setTimeout(resolve, 50));
    try {
      await connection.close();
      expect(processExists(parentPid)).toBe(false);
      expect(processExists(descendantPid)).toBe(false);
    } finally {
      await stopProcess(parentPid);
      await stopProcess(descendantPid);
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function expectFramingFailure(
  mode: string,
  code: McpProtocolError["code"],
  options?: { command?: string; startupEnvironment?: Record<string, string> },
): Promise<void> {
  const fixture = framingFixture(mode, options);
  const failure = await rejectionOf(fixture.connection.listTools());
  expect(failure).toBeInstanceOf(McpProtocolError);
  expect(failure).toMatchObject({ code });
  expect(await rejectionOf(fixture.connection.callTool("after", {}))).toBe(failure);
  await closeFramingFixture(fixture);
}

describe("stdio MCP protocol framing", () => {
  test("accepts an initialize frame exactly at four MiB", async () => {
    const fixture = framingFixture("exact-limit");
    try {
      expect((await fixture.connection.listTools()).map((tool) => tool.name)).toEqual([
        String(fixture.child().pid),
      ]);
    } finally {
      await closeFramingFixture(fixture);
    }
  });

  test("accepts notifications and concurrent responses in reverse order", async () => {
    const fixture = framingFixture("concurrent-reverse-notification");
    await fixture.connection.listTools();
    const [first, second] = await Promise.all([
      fixture.connection.callTool("first", {}),
      fixture.connection.callTool("second", {}),
    ]);
    expect(first).toMatchObject({ content: [{ type: "text", text: "first" }] });
    expect(second).toMatchObject({ content: [{ type: "text", text: "second" }] });
    await closeFramingFixture(fixture);
  });

  for (const mode of ["notification", "notification-no-params", "json-whitespace"] as const) {
    test(`accepts protocol-valid ${mode} traffic`, async () => {
      const fixture = framingFixture(mode);
      expect(await fixture.connection.listTools()).toHaveLength(1);
      await closeFramingFixture(fixture);
    });
  }

  for (const mode of ["ping-string", "ping-number", "unsupported-request"] as const) {
    test(`forwards ${mode} through the SDK server-request handling`, async () => {
      const fixture = framingFixture(mode);
      expect((await fixture.connection.listTools()).map((tool) => tool.name)).toEqual(["handled"]);
      await expect(fixture.connection.callTool("after", {})).resolves.toMatchObject({ content: [] });
      await closeFramingFixture(fixture);
    });
  }

  test("routes same-chunk traffic after the bootstrap acknowledgement", async () => {
    const fixture = framingFixture("ready-notification-same-chunk", {
      startupEnvironment: { FIXTURE_TOKEN: "isolated" },
    });
    expect(await fixture.connection.listTools()).toHaveLength(1);
    await closeFramingFixture(fixture);
  });

  for (const mode of ["pre-ready-notification", "pre-ready-response"] as const) {
    test(`rejects ${mode} before bootstrap completes`, async () => {
      await expectFramingFailure(mode, "unexpected-message", {
        startupEnvironment: { FIXTURE_TOKEN: "isolated" },
      });
    });
  }

  test("rejects a duplicate bootstrap acknowledgement", async () => {
    await expectFramingFailure("duplicate-bootstrap", "unexpected-bootstrap", {
      startupEnvironment: { FIXTURE_TOKEN: "isolated" },
    });
  });

  test("rejects malformed JSON during bootstrap", async () => {
    await expectFramingFailure("bootstrap-malformed", "malformed-json", {
      startupEnvironment: { FIXTURE_TOKEN: "isolated" },
    });
  });

  for (const [mode, code] of [
    ["limit-plus-one", "frame-too-large"],
    ["invalid-utf8", "invalid-utf8"],
    ["malformed-json", "malformed-json"],
    ["blank-frame", "malformed-json"],
    ["whitespace-frame", "malformed-json"],
    ["invalid-rpc-schema", "invalid-json-rpc"],
    ["invalid-rpc-shape", "invalid-json-rpc"],
    ["scalar-notification-params", "invalid-json-rpc"],
    ["array-notification-params", "invalid-json-rpc"],
    ["null-notification-params", "invalid-json-rpc"],
    ["scalar-request-params", "invalid-json-rpc"],
    ["eof-partial", "unexpected-eof"],
    ["stdout-partial-live", "unexpected-eof"],
  ] as const) {
    test(`fails closed on ${mode}`, async () => {
      await expectFramingFailure(mode, code, {
        ...(mode === "stdout-partial-live" ? { command: "node" } : {}),
      });
    });
  }

  test("fails terminally when stdout ends while the child remains alive", async () => {
    const fixture = framingFixture("stdout-clean-live", { command: "node" });
    const first = await rejectionOf(fixture.connection.listTools());
    expect(first).toMatchObject({ message: "MCP server output ended" });
    expect(await rejectionOf(fixture.connection.callTool("after", {}))).toBe(first);
    await closeFramingFixture(fixture);
  });

  test("rejects every pending request with one protocol error", async () => {
    const fixture = framingFixture("pending-malformed");
    await fixture.connection.listTools();
    const [first, second] = await Promise.all([
      rejectionOf(fixture.connection.callTool("first", {})),
      rejectionOf(fixture.connection.callTool("second", {})),
    ]);
    expect(first).toBeInstanceOf(McpProtocolError);
    expect(first).toMatchObject({ code: "malformed-json" });
    expect(second).toBe(first);
    expect(await rejectionOf(fixture.connection.callTool("after", {}))).toBe(first);
    await closeFramingFixture(fixture);
  });

  test("bounds parent-exit draining and terminates descendants holding stdout", async () => {
    const fixture = framingFixture("parent-exit-descendant");
    await fixture.connection.callTool("warmup", {});
    const group = fixture.child().pid;
    if (!group) throw new Error("MCP fixture has no process group");
    const first = await rejectionOf(fixture.connection.listTools());
    expect(first).toMatchObject({ message: "MCP server exited" });
    expect(await rejectionOf(fixture.connection.callTool("after", {}))).toBe(first);
    await closeFramingFixture(fixture);
    expect(processGroupExists(group)).toBe(false);
  });

  test("delivers a final complete response before child-exit teardown", async () => {
    const fixture = framingFixture("final-response-exit");
    expect((await fixture.connection.listTools()).map((tool) => tool.name)).toEqual(["final"]);
    const first = await rejectionOf(fixture.connection.callTool("after", {}));
    expect(first).toBeInstanceOf(Error);
    expect(await rejectionOf(fixture.connection.listTools())).toBe(first);
    await closeFramingFixture(fixture);
  });

  test("drains the final initialize response before reporting child exit", async () => {
    const fixture = framingFixture("initialize-response-exit");
    const first = await rejectionOf(fixture.connection.listTools());
    expect(first).toBeInstanceOf(Error);
    if (!(first instanceof Error)) throw new Error("Expected MCP failure");
    expect(first.message).not.toContain("timed out");
    expect(await rejectionOf(fixture.connection.callTool("after", {}))).toBe(first);
    await closeFramingFixture(fixture);
  });

  test("converges stderr stream errors and clears owned listeners", async () => {
    const fixture = framingFixture("request-timeout");
    await fixture.connection.listTools();
    const pending = fixture.connection.callTool("hang", {});
    const failure = new Error("fixture stderr failed");
    fixture.child().stderr?.emit("error", failure);
    expect(await rejectionOf(pending)).toBe(failure);
    expect(await rejectionOf(fixture.connection.callTool("after", {}))).toBe(failure);
    await closeFramingFixture(fixture);
  });

  test("settles a spawn-close race without retaining listeners", async () => {
    let child: ChildProcess | null = null;
    const spawnProcess: McpSpawn = (command, args, options) => {
      child = spawn(command, args, options);
      return child;
    };
    const connection = connectMcp(
      {
        transport: "stdio",
        command: path.join(tmpdir(), `missing-mcp-${process.pid}`),
      },
      { spawn: spawnProcess, shutdownGraceMs: 20 },
    );
    const fixture: FramingFixture = {
      child: () => {
        if (!child) throw new Error("MCP fixture did not spawn");
        return child;
      },
      connection,
    };
    expect(await rejectionOf(connection.listTools())).toBeInstanceOf(Error);
    await closeFramingFixture(fixture);
  });
});
