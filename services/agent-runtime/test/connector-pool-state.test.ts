import { describe, expect, test } from "bun:test";
import type { McpConnection } from "../src/mcp-client";
import {
  closePooledConnection,
  getOrCreatePooledConnection,
  hasPendingPooledConnections,
} from "../src/connector-pool-state";

function connection(close: () => Promise<void>): McpConnection {
  return {
    listTools: async () => [],
    callTool: async () => undefined,
    close,
  };
}

describe("connector pool state", () => {
  test("shares one creation across concurrent gets", async () => {
    const connectorId = "concurrent-get";
    const release = Promise.withResolvers<void>();
    let creations = 0;
    const create = async () => {
      creations += 1;
      await release.promise;
      return connection(async () => undefined);
    };
    const first = getOrCreatePooledConnection(connectorId, create);
    const second = getOrCreatePooledConnection(connectorId, create);
    release.resolve();
    const [firstConnection, secondConnection] = await Promise.all([first, second]);
    expect(creations).toBe(1);
    expect(secondConnection).toBe(firstConnection);
    await closePooledConnection(connectorId);
    expect(hasPendingPooledConnections()).toBe(false);
  });

  test("close drains a connection created after shutdown begins", async () => {
    const connectorId = "create-close";
    const allowCreation = Promise.withResolvers<void>();
    const allowClose = Promise.withResolvers<void>();
    const creationStarted = Promise.withResolvers<void>();
    let closes = 0;
    const creating = getOrCreatePooledConnection(connectorId, async () => {
      creationStarted.resolve();
      await allowCreation.promise;
      return connection(async () => {
        closes += 1;
        await allowClose.promise;
      });
    });
    await creationStarted.promise;
    let shutdownSettled = false;
    const shutdown = closePooledConnection(connectorId).then(() => {
      shutdownSettled = true;
    });
    allowCreation.resolve();
    await expect(creating).rejects.toThrow(/closed while connecting/);
    expect(shutdownSettled).toBe(false);
    expect(closes).toBe(1);
    expect(hasPendingPooledConnections()).toBe(true);
    allowClose.resolve();
    await shutdown;
    expect(shutdownSettled).toBe(true);
    expect(hasPendingPooledConnections()).toBe(false);
  });

  test("does not replace a connection until failed shutdown is retried", async () => {
    const connectorId = "failed-close";
    let allowClose = false;
    let creations = 0;
    const create = async () => {
      creations += 1;
      return connection(async () => {
        if (!allowClose) throw new Error("shutdown refused");
      });
    };
    await getOrCreatePooledConnection(connectorId, create);
    await expect(closePooledConnection(connectorId)).rejects.toThrow(/shutdown failed/);
    await expect(getOrCreatePooledConnection(connectorId, create)).rejects.toThrow(
      /shutdown failed/,
    );
    expect(creations).toBe(1);
    expect(hasPendingPooledConnections()).toBe(true);
    allowClose = true;
    await closePooledConnection(connectorId);
    await getOrCreatePooledConnection(connectorId, create);
    expect(creations).toBe(2);
    await closePooledConnection(connectorId);
    expect(hasPendingPooledConnections()).toBe(false);
  });
});
