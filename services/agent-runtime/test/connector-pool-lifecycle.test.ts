import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ConnectorConfig } from "../src/connector-contract";
import {
  authorizedConnectorTool,
  beginConnectorSecurityTransition,
  closePooledConnection,
  getPooledConnection,
} from "../src/connector-pool";
import { listConnectors, removeConnector, upsertConnectors } from "../src/connectors-service";
import { commitConnectorSecurityTransition } from "../src/plugin-runtime";

const roots: string[] = [];
const previousDataDir = process.env.LOCAL_STUDIO_DATA_DIR;

afterEach(async () => {
  if (previousDataDir === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
  else process.env.LOCAL_STUDIO_DATA_DIR = previousDataDir;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("connector security transitions", () => {
  test("rejects new authorization while a connector lifecycle transition is gated", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "local-studio-connector-transition-"));
    roots.push(dataDir);
    process.env.LOCAL_STUDIO_DATA_DIR = dataDir;
    await writeFile(
      path.join(dataDir, "connectors.json"),
      JSON.stringify({
        connectors: [
          {
            id: "transition-fixture",
            name: "Transition fixture",
            transport: "http",
            url: "http://connector.test/mcp",
            allowTools: ["observe"],
            permissionReviewed: true,
            enabled: true,
          },
        ],
      }),
    );
    const transition = beginConnectorSecurityTransition(["transition-fixture"]);
    await expect(authorizedConnectorTool("transition-fixture", "observe")).rejects.toThrow(
      "transition",
    );
    transition.release();
    await expect(authorizedConnectorTool("transition-fixture", "observe")).resolves.toMatchObject({
      id: "transition-fixture",
    });
  });

  test("keeps authorization gated when bounded shutdown fails", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "local-studio-connector-close-failure-"));
    roots.push(dataDir);
    process.env.LOCAL_STUDIO_DATA_DIR = dataDir;
    const server = path.join(dataDir, "server.mjs");
    await writeFile(
      server,
      `process.stdin.setEncoding("utf8");
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\\n");
  while (newline !== -1) {
    const message = JSON.parse(buffer.slice(0, newline));
    buffer = buffer.slice(newline + 1);
    newline = buffer.indexOf("\\n");
    const result = message.method === "initialize"
      ? { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "lifecycle", version: "1.0.0" } }
      : { tools: [{ name: "observe", inputSchema: { type: "object" } }] };
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\\n");
  }
});
`,
    );
    await writeFile(
      path.join(dataDir, "connectors.json"),
      JSON.stringify({
        connectors: [
          {
            id: "close-failure",
            name: "Close failure",
            transport: "stdio",
            command: process.execPath,
            args: [server],
            cwd: dataDir,
            allowTools: ["observe"],
            permissionReviewed: true,
            enabled: true,
          },
        ],
      }),
    );
    const connection = await getPooledConnection("close-failure");
    await connection.listTools();
    const close = connection.close.bind(connection);
    connection.close = async () => {
      throw new Error("bounded shutdown failed");
    };
    const transition = beginConnectorSecurityTransition(["close-failure"]);
    try {
      await expect(transition.shutdown()).rejects.toThrow("Connector shutdown failed");
      await expect(authorizedConnectorTool("close-failure", "observe")).rejects.toThrow(
        "transition",
      );
    } finally {
      transition.release();
      let retried = 0;
      connection.close = async () => {
        retried += 1;
        await close();
      };
      try {
        await closePooledConnection("close-failure");
        expect(retried).toBe(1);
      } finally {
        await close();
      }
    }
  });

  test("waits for every close and retries retained failures before completing", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "local-studio-connector-close-all-"));
    roots.push(dataDir);
    process.env.LOCAL_STUDIO_DATA_DIR = dataDir;
    const server = path.join(dataDir, "server.mjs");
    await writeFile(
      server,
      `import { writeFileSync } from "node:fs";
writeFileSync(process.argv[2], String(process.pid));
process.stdin.setEncoding("utf8");
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\\n");
  while (newline !== -1) {
    const message = JSON.parse(buffer.slice(0, newline));
    buffer = buffer.slice(newline + 1);
    newline = buffer.indexOf("\\n");
    const result = message.method === "initialize"
      ? { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "all", version: "1.0.0" } }
      : { tools: [{ name: "observe", inputSchema: { type: "object" } }] };
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\\n");
  }
});
`,
    );
    await writeFile(
      path.join(dataDir, "connectors.json"),
      JSON.stringify({
        connectors: ["first", "second"].map((id) => ({
          id,
          name: id,
          transport: "stdio",
          command: process.execPath,
          args: [server, path.join(dataDir, `${id}.pid`)],
          cwd: dataDir,
          allowTools: ["observe"],
          permissionReviewed: true,
          enabled: true,
        })),
      }),
    );
    const [first, second] = await Promise.all([
      getPooledConnection("first"),
      getPooledConnection("second"),
    ]);
    await Promise.all([first.listTools(), second.listTools()]);
    const pids = await Promise.all(
      ["first", "second"].map(async (id) =>
        Number(await readFile(path.join(dataDir, `${id}.pid`))),
      ),
    );
    const closeFirst = first.close.bind(first);
    const closeSecond = second.close.bind(second);
    let releaseSecond = (): void => undefined;
    const secondMayClose = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    let firstCalls = 0;
    let secondCalls = 0;
    first.close = async () => {
      firstCalls += 1;
      if (firstCalls === 1) throw new Error("transient close failure");
      await closeFirst();
    };
    second.close = async () => {
      secondCalls += 1;
      await secondMayClose;
      await closeSecond();
    };
    const transition = beginConnectorSecurityTransition(["first", "second"]);
    let settled = false;
    const shutdown = transition.shutdown().finally(() => {
      settled = true;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    try {
      expect(firstCalls).toBe(1);
      expect(secondCalls).toBe(1);
      expect(settled).toBe(false);
      releaseSecond();
      await expect(shutdown).resolves.toBeUndefined();
      expect(firstCalls).toBe(2);
      expect(secondCalls).toBe(1);
      expect(
        pids.every((pid) => {
          try {
            process.kill(pid, 0);
            return false;
          } catch (error) {
            return error instanceof Error && Reflect.get(error, "code") === "ESRCH";
          }
        }),
      ).toBe(true);
    } finally {
      releaseSecond();
      transition.release();
      await Promise.allSettled([closeFirst(), closeSecond()]);
    }
  });

  test("does not restore a removed connector from a failed transition fallback", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "local-studio-transition-fallback-"));
    roots.push(dataDir);
    process.env.LOCAL_STUDIO_DATA_DIR = dataDir;
    const connector: ConnectorConfig = {
      id: "fallback-removed",
      name: "Fallback removed",
      transport: "http",
      url: "http://connector.test/mcp",
      allowTools: ["observe"],
      permissionReviewed: true,
      enabled: true,
    };
    await upsertConnectors([connector]);
    await expect(
      commitConnectorSecurityTransition([{ expected: connector, replacement: connector }], true, {
        begin: () => ({
          shutdown: async () => {
            await removeConnector(connector.id);
            throw new Error("bounded shutdown failed");
          },
          release: () => undefined,
        }),
      }),
    ).rejects.toThrow("bounded shutdown failed");
    expect((await listConnectors()).some((entry) => entry.id === connector.id)).toBe(false);
  });

  test("does not retry a failed expected-absence update after reporting a collision", async () => {
    const replacement: ConnectorConfig = {
      id: "fallback-collision",
      name: "Plugin connector",
      transport: "http",
      url: "http://plugin.test/mcp",
      allowTools: [],
      permissionReviewed: false,
      origin: { kind: "plugin", id: "fixture", binding: "server" },
      enabled: true,
    };
    let connectors: ConnectorConfig[] = [
      {
        ...replacement,
        name: "Concurrent owner",
        origin: undefined,
      },
    ];
    let replaceCalls = 0;
    await expect(
      commitConnectorSecurityTransition([{ expected: null, replacement }], true, {
        begin: () => ({ shutdown: async () => undefined, release: () => undefined }),
        read: async () => connectors,
        replace: async (updates) => {
          replaceCalls += 1;
          if (replaceCalls === 1) {
            const result = { connectors, committed: false };
            connectors = [];
            return result;
          }
          connectors = updates.map(({ replacement: connector }) => connector);
          return { connectors, committed: true };
        },
      }),
    ).rejects.toThrow('Connector "fallback-collision" already exists');
    expect(replaceCalls).toBe(1);
    expect(connectors).toEqual([]);
  });
});
