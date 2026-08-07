import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connectMcp, McpProtocolError, type McpConnection } from "../src/mcp-client";
import { MAX_MCP_STDIO_BUFFER_BYTES } from "../src/mcp-stdio-transport";

const fixture = fileURLToPath(new URL("./fixtures/mcp-stdio-server.mjs", import.meta.url));
const connections: McpConnection[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const connection of connections.splice(0)) connection.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const connectionFor = (mode: string, pidFile?: string): McpConnection => {
  const connection = connectMcp({
    transport: "stdio",
    command: process.execPath,
    args: [fixture, mode, String(MAX_MCP_STDIO_BUFFER_BYTES), ...(pidFile ? [pidFile] : [])],
  });
  connections.push(connection);
  return connection;
};

const within = async <T>(promise: Promise<T>, timeoutMs = 3_000): Promise<T> => {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("operation did not settle")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
};

const rejected = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await within(promise);
    throw new Error("operation unexpectedly resolved");
  } catch (error) {
    return error;
  }
};

const processExists = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && Reflect.get(error, "code") === "ESRCH");
  }
};

const waitForExit = async (pid: number): Promise<void> => {
  const deadline = Date.now() + 5_000;
  while (processExists(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  expect(processExists(pid)).toBe(false);
};

describe("bounded MCP stdio transport", () => {
  test("accepts a frame whose buffered bytes reach the four MiB boundary", async () => {
    const tools = await within(connectionFor("exact-limit").listTools(), 10_000);
    expect(tools.map((tool) => tool.name)).toEqual(["exact-limit"]);
  });

  test("preserves split UTF-8 and multiple frames per chunk", async () => {
    const split = await within(connectionFor("split-utf8").listTools());
    const multiple = await within(connectionFor("multiple-frames").listTools());
    expect(split.map((tool) => tool.name)).toEqual(["split-utf8"]);
    expect(multiple.map((tool) => tool.name)).toEqual(["multiple-frames"]);
  });

  test("bounds each split frame without rejecting the next frame in its final chunk", async () => {
    const connection = connectionFor("near-limit-split-next-frame");
    const first = await within(connection.listTools(), 10_000);
    const second = await within(connection.listTools(), 10_000);
    expect(first.map((tool) => tool.name)).toEqual(["near-limit-split-next-frame"]);
    expect(second.map((tool) => tool.name)).toEqual(["near-limit-split-next-frame"]);
  });

  test("rejects a no-newline frame beyond four MiB with a typed terminal error", async () => {
    const error = await rejected(connectionFor("overflow-initialize").listTools());
    expect(error).toBeInstanceOf(McpProtocolError);
    expect(error).toMatchObject({ code: "frame-too-large" });
  });

  test("makes malformed JSON and invalid JSON-RPC terminal", async () => {
    const malformed = await rejected(connectionFor("malformed-list").listTools());
    const invalid = await rejected(connectionFor("invalid-rpc-list").listTools());
    expect(malformed).toMatchObject({ name: "McpProtocolError", code: "malformed-json" });
    expect(invalid).toMatchObject({ name: "McpProtocolError", code: "invalid-json-rpc" });
  });

  test("drops later frames from the chunk that made the connection terminal", async () => {
    const connection = connectionFor("malformed-then-response");
    const firstError = await rejected(connection.listTools());
    const futureError = await rejected(connection.listTools());
    expect(firstError).toMatchObject({ name: "McpProtocolError", code: "malformed-json" });
    expect(futureError).toBe(firstError);
  });

  test("rejects pending and future calls with the same terminal error", async () => {
    const connection = connectionFor("pending-malformed");
    await within(connection.listTools());
    const first = connection.callTool("first", {});
    const second = connection.callTool("second", {});
    const [firstError, secondError] = await Promise.all([rejected(first), rejected(second)]);
    const futureError = await rejected(connection.listTools());
    expect(firstError).toBeInstanceOf(McpProtocolError);
    expect(firstError).toBe(secondError);
    expect(futureError).toBe(firstError);
  });

  test("terminates the child after a terminal protocol failure", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "local-studio-mcp-framing-"));
    roots.push(root);
    const pidFile = path.join(root, "server.pid");
    const connection = connectionFor("malformed-list", pidFile);
    const error = await rejected(connection.listTools());
    expect(error).toBeInstanceOf(McpProtocolError);
    const pid = Number(await readFile(pidFile, "utf8"));
    await waitForExit(pid);
  });
});
