import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "../../../frontend/node_modules/effect/dist/index.js";
import { connectorApprovalBroker } from "../../../services/agent-runtime/src/connector-approval";
import type {
  ConnectorApprovalView,
  ConnectorConfig,
} from "../../../services/agent-runtime/src/connector-contract";
import { connectorInventoryDigest } from "../../../services/agent-runtime/src/connector-inventory";
import {
  callConnectorTool,
  closePooledConnection,
  probeConnector,
} from "../../../services/agent-runtime/src/connector-pool";
import {
  listConnectors,
  removeConnector,
  upsertConnectors,
} from "../../../services/agent-runtime/src/connectors-service";
import {
  setPluginEnabled,
  updatePluginConnectorGrant,
} from "../../../services/agent-runtime/src/plugin-runtime";
import {
  GET as listConnectorInventory,
  POST as callConnector,
} from "../../../frontend/src/app/api/agent/connectors/call/route";
import { POST as activatePlugin } from "../../../frontend/src/app/api/agent/plugins/[id]/route";

type FakeCall = { id: number; method: string; tool?: string };
type Deferred = { promise: Promise<void>; resolve: () => void };
type ToolsListGate = { skips: number; reached: Deferred; release: Deferred };

function deferred(): Deferred {
  let resolve = () => undefined;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

const stdioServerSource = `
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\\n");
  while (newline !== -1) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    newline = buffer.indexOf("\\n");
    const request = JSON.parse(line);
    if (typeof request.id !== "number") continue;
    const result = request.method === "initialize"
      ? {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: { name: "fixture", version: "1.0.0" },
        }
      : request.method === "tools/list"
        ? {
            tools: [
              {
                name: "observe",
                inputSchema: { type: "object" },
                annotations: { readOnlyHint: true },
              },
            ],
          }
        : { content: [{ type: "text", text: "observe" }] };
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\\n");
  }
});
`;

function fakeCall(input: unknown): FakeCall {
  if (input === null || typeof input !== "object") throw new Error("Invalid fake MCP call");
  const id = Reflect.get(input, "id");
  const method = Reflect.get(input, "method");
  const params = Reflect.get(input, "params");
  const tool =
    params !== null && typeof params === "object" ? Reflect.get(params, "name") : undefined;
  if (typeof id !== "number" || typeof method !== "string") {
    throw new Error("Invalid fake MCP call");
  }
  return { id, method, ...(typeof tool === "string" ? { tool } : {}) };
}

async function pendingApproval(sessionId: string): Promise<ConnectorApprovalView> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const pending = connectorApprovalBroker
      .pending()
      .find((approval) => approval.session_id === sessionId);
    if (pending) return pending;
    await Bun.sleep(5);
  }
  throw new Error(`No pending approval for ${sessionId}`);
}

async function makeWritable(entry: string): Promise<void> {
  const stat = await lstat(entry);
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    await chmod(entry, 0o700);
    for (const name of await readdir(entry)) await makeWritable(path.join(entry, name));
    return;
  }
  if (stat.isFile()) await chmod(entry, 0o600);
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
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

describe("plugin invocation identity boundary", () => {
  const pluginId = "invocation-fixture";
  const connectorId = "plugin-invocation-fixture-server";
  const endpoint = "http://plugin-invocation.test/mcp";
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  const previousDataDir = process.env.LOCAL_STUDIO_DATA_DIR;
  let dataDir = "";
  let pluginRoot = "";
  let tools = [
    {
      name: "observe",
      inputSchema: { type: "object" as const },
      annotations: { readOnlyHint: true },
    },
  ];
  let toolsListGate: ToolsListGate | null = null;

  beforeAll(() => {
    globalThis.fetch = async (input, init) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url !== endpoint) return originalFetch(input, init);
      if (typeof init?.body !== "string") throw new Error("Fake MCP body is missing");
      const message = fakeCall(JSON.parse(init.body));
      if (message.method === "tools/call" && message.tool) calls.push(message.tool);
      if (message.method === "tools/list" && toolsListGate) {
        if (toolsListGate.skips > 0) toolsListGate.skips -= 1;
        else {
          const gate = toolsListGate;
          toolsListGate = null;
          gate.reached.resolve();
          await gate.release.promise;
        }
      }
      const result =
        message.method === "tools/list"
          ? { tools }
          : message.method === "tools/call"
            ? { content: [{ type: "text", text: message.tool ?? "" }] }
            : {
                protocolVersion: "2025-03-26",
                capabilities: {},
                serverInfo: { name: "fake", version: "1.0.0" },
              };
      return Response.json({ jsonrpc: "2.0", id: message.id, result });
    };
  });

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "local-studio-plugin-invocation-"));
    process.env.LOCAL_STUDIO_DATA_DIR = dataDir;
    pluginRoot = path.join(dataDir, "plugins", pluginId);
    await mkdir(path.join(pluginRoot, ".codex-plugin"), { recursive: true });
    await writeFile(
      path.join(pluginRoot, ".codex-plugin", "plugin.json"),
      JSON.stringify({ name: pluginId, version: "1.0.0", mcpServers: "./mcp.json" }),
    );
    await writeFile(
      path.join(pluginRoot, "mcp.json"),
      JSON.stringify({ mcpServers: { server: { type: "http", url: endpoint } } }),
    );
    calls.length = 0;
    tools = [
      {
        name: "observe",
        inputSchema: { type: "object" },
        annotations: { readOnlyHint: true },
      },
    ];
    toolsListGate = null;
  });

  afterEach(async () => {
    await closePooledConnection(connectorId);
    connectorApprovalBroker.cancelSession("approval-drift");
    await makeWritable(dataDir);
    await rm(dataDir, { recursive: true, force: true });
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
    if (previousDataDir === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
    else process.env.LOCAL_STUDIO_DATA_DIR = previousDataDir;
  });

  async function reviewedConnector(): Promise<ConnectorConfig> {
    await Effect.runPromise(Effect.flip(setPluginEnabled(pluginId, true)));
    const pending = (await listConnectors()).find((connector) => connector.id === connectorId);
    if (!pending?.origin?.artifactDigest) throw new Error("Plugin connector was not staged");
    const probe = await probeConnector(pending);
    if (!probe.ok) throw new Error("Plugin connector probe failed");
    await Effect.runPromise(
      updatePluginConnectorGrant({
        id: pending.id,
        allowTools: ["observe"],
        permissionReviewed: true,
        enabled: true,
        reviewedArtifactDigest: pending.origin.artifactDigest,
        reviewedInventoryDigest: connectorInventoryDigest(probe.tools),
      }),
    );
    const reviewed = (await listConnectors()).find((connector) => connector.id === connectorId);
    if (!reviewed) throw new Error("Reviewed plugin connector is missing");
    return reviewed;
  }

  test("blocks a direct internal call after same-version artifact mutation", async () => {
    const reviewed = await reviewedConnector();
    await writeFile(path.join(pluginRoot, "changed.txt"), "changed");
    await expect(callConnectorTool(reviewed, "observe", {})).rejects.toThrow();
    expect(calls).toEqual([]);
    expect(
      (await listConnectors()).find((connector) => connector.id === connectorId),
    ).toMatchObject({ allowTools: [], permissionReviewed: false, enabled: false });
  });

  test("reconciles artifact identity before connector inventory starts", async () => {
    await reviewedConnector();
    await writeFile(path.join(pluginRoot, "changed-before-inventory.txt"), "changed");
    expect(
      (await listConnectorInventory(new Request("http://localhost/api/agent/connectors/call")))
        .status,
    ).toBe(200);
    expect(calls).toEqual([]);
    expect(
      (await listConnectors()).find((connector) => connector.id === connectorId),
    ).toMatchObject({ allowTools: [], permissionReviewed: false, enabled: false });
  });

  test("revalidates artifact identity after a user approval wait", async () => {
    await reviewedConnector();
    const response = callConnector(
      new Request("http://localhost/api/agent/connectors/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: "approval-drift",
          connector_id: connectorId,
          tool: "observe",
          args: {},
        }),
      }),
    );
    const approval = await pendingApproval("approval-drift");
    await writeFile(path.join(pluginRoot, "changed-during-approval.txt"), "changed");
    connectorApprovalBroker.decide(approval.id, "approve");
    expect((await response).status).toBe(403);
    expect(calls).toEqual([]);
  });

  test("checks inventory on the exact pooled connection before every tool call", async () => {
    const reviewed = await reviewedConnector();
    await callConnectorTool(reviewed, "observe", {});
    expect(calls).toEqual(["observe"]);
    tools = [
      { name: "observe", annotations: { readOnlyHint: true } },
      { name: "new-tool", annotations: { readOnlyHint: true } },
    ];
    await expect(callConnectorTool(reviewed, "observe", {})).rejects.toThrow();
    expect(calls).toEqual(["observe"]);
    expect(
      (await listConnectors()).find((connector) => connector.id === connectorId),
    ).toMatchObject({ allowTools: [], permissionReviewed: false, enabled: false });
  });

  test("clears a reviewed stdio plugin when its source command bytes change", async () => {
    const runtime = path.join(dataDir, path.basename(process.execPath));
    await copyFile(process.execPath, runtime);
    await chmod(runtime, 0o755);
    await writeFile(path.join(pluginRoot, "server.mjs"), stdioServerSource);
    await writeFile(
      path.join(pluginRoot, "mcp.json"),
      JSON.stringify({
        mcpServers: { server: { command: runtime, args: ["./server.mjs"] } },
      }),
    );
    const reviewed = await reviewedConnector();
    await writeFile(runtime, "changed-runtime");
    await chmod(runtime, 0o755);
    await expect(callConnectorTool(reviewed, "observe", {})).rejects.toThrow();
    expect(
      (await listConnectors()).find((connector) => connector.id === connectorId),
    ).toMatchObject({ allowTools: [], permissionReviewed: false, enabled: false });
  });

  test("does not complete plugin deactivation before the owned process tree is gone", async () => {
    const runtime = path.join(dataDir, path.basename(process.execPath));
    const pidFile = path.join(dataDir, "plugin-tree.json");
    const descendant = ["process.on('SIGTERM', () => {})", "setInterval(() => {}, 1000)"].join(
      "\n",
    );
    const server = [
      "import { spawn } from 'node:child_process'",
      "import { writeFile } from 'node:fs/promises'",
      `const descendant = spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: 'ignore' })`,
      "process.on('SIGTERM', () => {})",
      "if (!process.env.PROJECT_ID) throw new Error('Missing process identity destination')",
      "await writeFile(process.env.PROJECT_ID, JSON.stringify([process.pid, descendant.pid]))",
      stdioServerSource,
    ].join("\n");
    await copyFile(process.execPath, runtime);
    await chmod(runtime, 0o755);
    await writeFile(path.join(pluginRoot, "server.mjs"), server);
    await writeFile(
      path.join(pluginRoot, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          server: { command: runtime, args: ["./server.mjs"], env: { PROJECT_ID: pidFile } },
        },
      }),
    );
    const reviewed = await reviewedConnector();
    await callConnectorTool(reviewed, "observe", {});
    const [parentPid, descendantPid] = JSON.parse(await Bun.file(pidFile).text()) as [
      number,
      number,
    ];
    try {
      const response = await activatePlugin(
        new Request(`http://localhost/api/agent/plugins/${pluginId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: false }),
        }),
        { params: Promise.resolve({ id: pluginId }) },
      );
      expect(response.status).toBe(200);
      expect(processExists(parentPid)).toBe(false);
      expect(processExists(descendantPid)).toBe(false);
    } finally {
      await closePooledConnection(connectorId);
      await stopProcess(parentPid);
      await stopProcess(descendantPid);
    }
  });

  test("does not resurrect a connector removed during a grant transition", async () => {
    const runtime = path.join(dataDir, path.basename(process.execPath));
    const events = path.join(dataDir, "grant-transition.log");
    const server = [
      "import { appendFileSync } from 'node:fs'",
      "appendFileSync(process.env.ACCOUNT_ID, 'start ' + process.pid + '\\n')",
      "process.on('SIGTERM', () => appendFileSync(process.env.ACCOUNT_ID, 'term ' + process.pid + '\\n'))",
      stdioServerSource,
    ].join("\n");
    await copyFile(process.execPath, runtime);
    await chmod(runtime, 0o755);
    await writeFile(events, "");
    await writeFile(path.join(pluginRoot, "server.mjs"), server);
    await writeFile(
      path.join(pluginRoot, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          server: { command: runtime, args: ["./server.mjs"], env: { ACCOUNT_ID: events } },
        },
      }),
    );
    const reviewed = await reviewedConnector();
    await callConnectorTool(reviewed, "observe", {});
    const pooledPid = (await readFile(events, "utf8"))
      .trim()
      .split("\n")
      .filter((entry) => entry.startsWith("start "))
      .at(-1)
      ?.slice(6);
    if (!pooledPid) throw new Error("Pooled plugin process did not start");
    await truncate(events, 0);
    const update = Effect.runPromise(
      updatePluginConnectorGrant({
        id: connectorId,
        allowTools: ["observe"],
        permissionReviewed: true,
        enabled: true,
      }),
    );
    let gated = false;
    for (let attempt = 0; attempt < 1_000; attempt += 1) {
      if ((await readFile(events, "utf8")).includes(`term ${pooledPid}`)) {
        gated = true;
        break;
      }
      await Bun.sleep(5);
    }
    expect(gated).toBe(true);
    await removeConnector(connectorId);
    expect((await listConnectors()).some((connector) => connector.id === connectorId)).toBe(false);
    const result = await update;
    expect(result.some((connector) => connector.id === connectorId)).toBe(false);
    expect((await listConnectors()).some((connector) => connector.id === connectorId)).toBe(false);
  });

  test("does not replace a custom connector that collides with a plugin connector id", async () => {
    const custom: ConnectorConfig = {
      id: connectorId,
      name: "Custom owner",
      transport: "http",
      url: "http://custom-owner.test/mcp",
      allowTools: ["custom-tool"],
      permissionReviewed: true,
      enabled: true,
    };
    await upsertConnectors([custom]);
    const error = await Effect.runPromise(Effect.flip(setPluginEnabled(pluginId, true)));
    expect(error).toMatchObject({ status: 409 });
    expect((await listConnectors()).find(({ id }) => id === connectorId)).toEqual(custom);
  });

  test("does not adopt a connector edit completed during a grant probe", async () => {
    const reviewed = await reviewedConnector();
    const reached = deferred();
    const release = deferred();
    toolsListGate = { skips: 1, reached, release };
    const update = Effect.runPromise(
      updatePluginConnectorGrant({
        id: connectorId,
        allowTools: ["observe"],
        permissionReviewed: true,
        enabled: true,
      }),
    );
    await reached.promise;
    const concurrent = { ...reviewed, allowTools: ["concurrent-tool"] };
    try {
      await upsertConnectors([concurrent]);
    } finally {
      release.resolve();
    }
    const error: unknown = await update.catch((failure: unknown) => failure);
    expect(error).toMatchObject({ status: 409 });
    expect((await listConnectors()).find(({ id }) => id === connectorId)).toEqual(concurrent);
  });
});
