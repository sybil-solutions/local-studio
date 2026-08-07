import { describe, expect, test } from "bun:test";
import { GITHUB_MCP_TOOLS, githubMcpConnectorConfiguration } from "../src/connector-artifacts";
import { GITHUB_CONNECTOR_TOKEN_KEY, type ConnectorConfig } from "../src/connector-contract";
import { makeConnectorPool } from "../src/connector-pool";
import type { McpConnection, McpTarget, McpToolInfo } from "../src/mcp-client";

const tools: McpToolInfo[] = [
  {
    name: GITHUB_MCP_TOOLS[0],
    inputSchema: { type: "object" },
  },
];

function managedConnector(token = "fixture-token"): ConnectorConfig {
  return githubMcpConnectorConfiguration({
    enabled: true,
    env: { [GITHUB_CONNECTOR_TOKEN_KEY]: token },
  });
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => undefined;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function fakeConnection(onClose: () => void = () => undefined): McpConnection {
  return {
    listTools: async () => tools,
    callTool: async (name) => ({ name }),
    close: async () => onClose(),
  };
}

describe("connector pool verification", () => {
  test("coalesces concurrent cold calls into one verified managed spawn", async () => {
    const connector = managedConnector();
    const verificationStarted = deferred();
    const releaseVerification = deferred();
    let verifications = 0;
    let spawns = 0;
    let closes = 0;
    const pool = makeConnectorPool({
      loadConnectors: async () => [connector],
      verifyGitHub: async () => {
        verifications += 1;
        verificationStarted.resolve();
        await releaseVerification.promise;
      },
      connect: () => {
        spawns += 1;
        return fakeConnection(() => {
          closes += 1;
        });
      },
    });

    const first = pool.listConnectorTools(connector.id);
    const second = pool.listConnectorTools(connector.id);
    await verificationStarted.promise;
    expect(verifications).toBe(1);
    expect(spawns).toBe(0);
    releaseVerification.resolve();

    expect(await Promise.all([first, second])).toEqual([tools, tools]);
    expect(verifications).toBe(1);
    expect(spawns).toBe(1);
    await pool.closePooledConnection(connector.id);
    expect(closes).toBe(1);
  });

  test("runs one full GitHub verification for each spawned pooled connection", async () => {
    const connector = managedConnector();
    let verifications = 0;
    let spawns = 0;
    let closes = 0;
    const pool = makeConnectorPool({
      loadConnectors: async () => [connector],
      verifyGitHub: async () => {
        verifications += 1;
      },
      connect: () => {
        spawns += 1;
        return fakeConnection(() => {
          closes += 1;
        });
      },
    });

    expect(await pool.listConnectorTools(connector.id)).toEqual(tools);
    expect(await pool.listConnectorTools(connector.id)).toEqual(tools);
    expect(verifications).toBe(1);
    expect(spawns).toBe(1);

    await pool.closePooledConnection(connector.id);
    expect(closes).toBe(1);
    expect(await pool.listConnectorTools(connector.id)).toEqual(tools);
    expect(verifications).toBe(2);
    expect(spawns).toBe(2);
    await pool.closePooledConnection(connector.id);
  });

  test("rejects managed configuration drift before reusing a pooled connection", async () => {
    let connector = managedConnector();
    let verifications = 0;
    let spawns = 0;
    const pool = makeConnectorPool({
      loadConnectors: async () => [connector],
      verifyGitHub: async () => {
        verifications += 1;
      },
      connect: () => {
        spawns += 1;
        return fakeConnection();
      },
    });

    await pool.listConnectorTools(connector.id);
    connector = { ...connector, allowTools: ["unreviewed-tool"] };

    await expect(pool.listConnectorTools(connector.id)).rejects.toThrow(
      "GitHub connector configuration is invalid",
    );
    expect(verifications).toBe(1);
    expect(spawns).toBe(1);
    await pool.closePooledConnection(connector.id);
  });

  test("replaces a pooled connection when its canonical credential identity changes", async () => {
    let connector = managedConnector("old-fixture-token");
    const targets: McpTarget[] = [];
    let closes = 0;
    const pool = makeConnectorPool({
      loadConnectors: async () => [connector],
      verifyGitHub: async () => undefined,
      connect: (target) => {
        targets.push(target);
        return fakeConnection(() => {
          closes += 1;
        });
      },
    });

    await pool.listConnectorTools(connector.id);
    connector = managedConnector("new-fixture-token");
    await pool.listConnectorTools(connector.id);

    expect(targets).toHaveLength(2);
    expect(targets[0]).toMatchObject({
      env: { [GITHUB_CONNECTOR_TOKEN_KEY]: "old-fixture-token" },
    });
    expect(targets[1]).toMatchObject({
      env: { [GITHUB_CONNECTOR_TOKEN_KEY]: "new-fixture-token" },
    });
    expect(closes).toBe(1);
    await pool.closePooledConnection(connector.id);
    expect(closes).toBe(2);
  });

  for (const scenario of ["credential update", "disable", "remove"] as const) {
    test(`invalidates and awaits pending verification during ${scenario}`, async () => {
      let connector: ConnectorConfig | null = managedConnector("old-fixture-token");
      const verificationStarted = deferred();
      const releaseVerification = deferred();
      let firstVerification = true;
      let pendingSignal: AbortSignal | undefined;
      let invalidationSettled = false;
      let spawns = 0;
      let closes = 0;
      const targets: McpTarget[] = [];
      const pool = makeConnectorPool({
        loadConnectors: async () => (connector ? [connector] : []),
        verifyGitHub: async (_candidate, signal) => {
          if (!firstVerification) return;
          firstVerification = false;
          pendingSignal = signal;
          verificationStarted.resolve();
          await releaseVerification.promise;
        },
        connect: (target) => {
          targets.push(target);
          spawns += 1;
          return fakeConnection(() => {
            closes += 1;
          });
        },
      });

      const operation = pool.listConnectorTools("github");
      await verificationStarted.promise;
      if (scenario === "credential update") connector = managedConnector("new-fixture-token");
      if (scenario === "disable" && connector) connector = { ...connector, enabled: false };
      if (scenario === "remove") connector = null;
      const invalidation = pool.closePooledConnection("github").then(() => {
        invalidationSettled = true;
      });

      expect(pendingSignal?.aborted).toBe(true);
      await Promise.resolve();
      expect(invalidationSettled).toBe(false);
      releaseVerification.resolve();
      await expect(operation).rejects.toThrow("connection was invalidated");
      await invalidation;
      expect(spawns).toBe(0);
      expect(closes).toBe(0);

      if (scenario === "credential update") {
        expect(await pool.listConnectorTools("github")).toEqual(tools);
        expect(targets[0]).toMatchObject({
          env: { [GITHUB_CONNECTOR_TOKEN_KEY]: "new-fixture-token" },
        });
        await pool.closePooledConnection("github");
        expect(closes).toBe(1);
      } else {
        await expect(pool.listConnectorTools("github")).rejects.toThrow(
          scenario === "disable" ? "disabled" : "Unknown connector",
        );
      }
    });
  }

  test("closes a child created reentrantly after its generation is invalidated", async () => {
    const connector = managedConnector();
    let invalidateDuringConnect = true;
    let invalidation: Promise<void> | null = null;
    let spawns = 0;
    let closes = 0;
    const pool = makeConnectorPool({
      loadConnectors: async () => [connector],
      verifyGitHub: async () => undefined,
      connect: () => {
        spawns += 1;
        const connection = fakeConnection(() => {
          closes += 1;
        });
        if (invalidateDuringConnect) {
          invalidateDuringConnect = false;
          invalidation = pool.closePooledConnection(connector.id);
        }
        return connection;
      },
    });

    await expect(pool.listConnectorTools(connector.id)).rejects.toThrow(
      "connection was invalidated",
    );
    await invalidation;
    expect(spawns).toBe(1);
    expect(closes).toBe(1);
    expect(await pool.listConnectorTools(connector.id)).toEqual(tools);
    expect(spawns).toBe(2);
    await pool.closePooledConnection(connector.id);
    expect(closes).toBe(2);
  });

  test("does not let an old operation close a replacement from a newer generation", async () => {
    const connector = managedConnector();
    const oldOperationStarted = deferred();
    const releaseOldOperation = deferred();
    let oldLists = 0;
    let spawns = 0;
    let closes = 0;
    const pool = makeConnectorPool({
      loadConnectors: async () => [connector],
      verifyGitHub: async () => undefined,
      connect: () => {
        spawns += 1;
        const generation = spawns;
        return {
          listTools: async () => {
            if (generation !== 1 || oldLists++ === 0) return tools;
            oldOperationStarted.resolve();
            await releaseOldOperation.promise;
            throw new Error("old operation failed");
          },
          callTool: async (name) => ({ name }),
          close: async () => {
            closes += 1;
          },
        };
      },
    });

    await pool.listConnectorTools(connector.id);
    const oldOperation = pool.listConnectorTools(connector.id);
    await oldOperationStarted.promise;
    await pool.closePooledConnection(connector.id);
    expect(await pool.listConnectorTools(connector.id)).toEqual(tools);
    releaseOldOperation.resolve();
    await expect(oldOperation).rejects.toThrow("old operation failed");

    expect(await pool.listConnectorTools(connector.id)).toEqual(tools);
    expect(spawns).toBe(2);
    expect(closes).toBe(1);
    await pool.closePooledConnection(connector.id);
    expect(closes).toBe(2);
  });

  test("fully verifies each explicit GitHub probe immediately before connecting", async () => {
    const connector = managedConnector();
    const events: string[] = [];
    const pool = makeConnectorPool({
      verifyGitHub: async () => {
        events.push("verify");
      },
      connect: () => {
        events.push("connect");
        return fakeConnection(() => events.push("close"));
      },
    });

    expect(await pool.probeConnector(connector)).toMatchObject({ ok: true, tools });
    expect(events).toEqual(["verify", "connect", "close"]);
  });
});
