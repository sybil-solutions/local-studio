import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cancelConnectorApprovals,
  ConnectorApprovalError,
  connectorApprovalDigest,
  createConnectorApprovalBroker,
  executeConnectorTool,
} from "../src/connector-approval";
import type { ConnectorArguments, ConnectorConfig } from "../src/connector-contract";
import {
  closePooledConnection,
  filterAllowedConnectorTools,
  assertConnectorToolAllowed,
  ConnectorToolDeniedError,
  listConnectorTools,
} from "../src/connector-pool";
import {
  catalogConnectorConfiguration,
  connectorToolPermissions,
  connectorToolRisk,
} from "../src/connector-policy";
import {
  hasEnabledConnectorsSync,
  listConnectors,
  resolveConnectorsFilePath,
  saveConnectors,
} from "../src/connectors-service";
import type { McpToolInfo } from "../src/mcp-client";
import { applyReviewedConnectorInventory } from "../src/plugin-runtime";

const originalDataDir = process.env.LOCAL_STUDIO_DATA_DIR;
const temporaryDirectories: string[] = [];

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
  else process.env.LOCAL_STUDIO_DATA_DIR = originalDataDir;
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const connector = (overrides: Partial<ConnectorConfig> = {}): ConnectorConfig => ({
  id: "custom",
  name: "Custom",
  transport: "http",
  url: "http://127.0.0.1:3999/mcp",
  enabled: true,
  ...overrides,
});

const approvedConnector = (overrides: Partial<ConnectorConfig> = {}): ConnectorConfig =>
  connector({ allowTools: ["write"], permissionReviewed: true, ...overrides });

const approvalScope = (
  args: ConnectorArguments,
  overrides: Partial<{ sessionId: string; connector: ConnectorConfig; tool: string }> = {},
) => ({
  sessionId: overrides.sessionId ?? "session-a",
  connector: overrides.connector ?? approvedConnector(),
  tool: overrides.tool ?? "write",
  args,
});

const tool = (name: string, readOnlyHint = false): McpToolInfo =>
  ({
    name,
    inputSchema: { type: "object" },
    ...(readOnlyHint ? { annotations: { readOnlyHint: true } } : {}),
  }) as McpToolInfo;

const useTemporaryData = (): void => {
  const directory = mkdtempSync(join(tmpdir(), "local-studio-connector-grants-"));
  temporaryDirectories.push(directory);
  process.env.LOCAL_STUDIO_DATA_DIR = directory;
};

describe("connector grants", () => {
  test("disables persisted connectors whose grant was not explicitly reviewed", async () => {
    useTemporaryData();
    await saveConnectors([connector()]);
    expect(await listConnectors()).toEqual([
      expect.objectContaining({ allowTools: [], permissionReviewed: false, enabled: false }),
    ]);

    writeFileSync(resolveConnectorsFilePath(), JSON.stringify({ connectors: [connector()] }), {
      mode: 0o600,
    });
    expect(hasEnabledConnectorsSync()).toBe(false);
  });

  test("filters inventory and execution through the same explicit allowlist", () => {
    const reviewed = connector({
      allowTools: ["read"],
      permissionReviewed: true,
    });
    expect(filterAllowedConnectorTools(reviewed, [tool("read"), tool("write")])).toEqual([
      tool("read"),
    ]);
    expect(() => assertConnectorToolAllowed(reviewed, "read")).not.toThrow();
    expect(() => assertConnectorToolAllowed(reviewed, "write")).toThrow(ConnectorToolDeniedError);
    expect(filterAllowedConnectorTools(connector(), [tool("read")])).toEqual([]);
  });

  test("uses first-party catalog risk instead of connector annotations", () => {
    const github = catalogConnectorConfiguration(
      connector({
        id: "github",
        name: "GitHub",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: "synthetic" },
        url: undefined,
        allowTools: ["get_issue", "create_issue", "unknown"],
        permissionReviewed: true,
      }),
      "github",
    );
    expect(connectorToolRisk(github, "get_issue")).toBe("read");
    expect(connectorToolRisk(github, "create_issue")).toBe("mutating");
    expect(connectorToolRisk(github, "unknown")).toBe("critical");
    expect(connectorToolPermissions(github, [tool("unknown", true)])[0]).toEqual({
      name: "unknown",
      risk: "critical",
      granted: true,
      default_granted: false,
    });
    expect(() =>
      catalogConnectorConfiguration({ ...github, permissionReviewed: false }, "github"),
    ).toThrow(/Review and save/);

    const x = catalogConnectorConfiguration(
      connector({
        id: "x",
        name: "X",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@enescinar/twitter-mcp"],
        env: {
          API_KEY: "synthetic",
          API_SECRET_KEY: "synthetic",
          ACCESS_TOKEN: "synthetic",
          ACCESS_TOKEN_SECRET: "synthetic",
        },
        url: undefined,
        allowTools: ["search_tweets", "post_tweet"],
        permissionReviewed: true,
      }),
      "x",
    );
    expect(connectorToolRisk(x, "search_tweets")).toBe("read");
    expect(connectorToolRisk(x, "post_tweet")).toBe("mutating");
    expect(connectorToolRisk(x, "unknown")).toBe("critical");

    const google = connector({
      origin: { kind: "account-adapter", id: "gmail", binding: "google-workspace" },
    });
    expect(connectorToolRisk(google, "list_labels")).toBe("read");
    expect(connectorToolRisk(google, "send_message")).toBe("critical");
  });

  test("lists only explicitly granted tools from a pooled connector", async () => {
    useTemporaryData();
    const live = approvedConnector({
      transport: "stdio",
      command: process.execPath,
      args: [join(import.meta.dir, "fixtures/connector-server.mjs")],
      url: undefined,
    });
    await saveConnectors([live]);
    try {
      expect((await listConnectorTools(live.id)).map((entry) => entry.name)).toEqual(["write"]);
    } finally {
      closePooledConnection(live.id);
    }
  });

  test("stages unreviewed plugin tools even when they claim to be read-only", () => {
    const plugin = connector({
      origin: { kind: "plugin", id: "sample", version: "1", binding: "mcp" },
    });
    expect(applyReviewedConnectorInventory(plugin, [tool("observe", true)])).toEqual(
      expect.objectContaining({ allowTools: [], permissionReviewed: false, enabled: false }),
    );
    const reviewed = { ...plugin, allowTools: ["observe"], permissionReviewed: true };
    expect(applyReviewedConnectorInventory(reviewed, [tool("observe")]).enabled).toBe(true);
    expect(() => applyReviewedConnectorInventory(reviewed, [tool("other")])).toThrow(
      /approved tool inventory changed/,
    );
  });
});

describe("connector action approval", () => {
  test("digests canonical full JSON scope", () => {
    const key = Buffer.alloc(32, 7);
    const digest = (args: ConnectorArguments) =>
      connectorApprovalDigest(key, approvalScope(args)).toString("hex");
    const original = digest({ nested: { a: 1, b: 2 }, values: [1, 2], nullable: null });
    expect(digest({ nullable: null, values: [1, 2], nested: { b: 2, a: 1 } })).toBe(original);
    for (const changed of [
      { nested: { a: 1, b: 2 }, values: [2, 1], nullable: null },
      { nested: { a: 1, b: 2 }, values: [1, 2] },
      { nested: { a: 1, b: 2 }, values: [1, 2], nullable: false },
      { nested: { a: 1, b: 2 }, values: [1, 2], nullable: null, token: "other" },
    ]) {
      expect(digest(changed)).not.toBe(original);
    }
  });

  test("consumes an exact approval once without exposing argument values", () => {
    const broker = createConnectorApprovalBroker({ key: Buffer.alloc(32, 3) });
    const secret = "synthetic-credential-value";
    const unsafe = `${"label".repeat(30)}\n\u202e`;
    const approved = approvalScope(
      { [unsafe]: secret, nested: { value: "private" } },
      { connector: approvedConnector({ id: unsafe, name: unsafe }), tool: unsafe },
    );
    const view = broker.begin(approved);
    expect(JSON.stringify(view)).not.toContain(secret);
    expect(broker.consume(view.id, approved, true)).toBe(true);
    expect(broker.consume(view.id, approved, true)).toBe(false);
    const metadata = JSON.stringify({ view, audit: broker.audit() });
    expect(metadata).not.toContain(secret);
    expect(metadata).not.toMatch(/[\n\u202e]/);
    expect(view.connectorName).toEndWith("…");
  });

  test("denies changed, expired, aborted, cancelled, and overflowing approvals", () => {
    let now = 100;
    const broker = createConnectorApprovalBroker({
      key: Buffer.alloc(32, 5),
      ttlMs: 10,
      now: () => now,
    });
    for (const changed of [
      approvalScope({ token: "b" }),
      approvalScope({ token: "a" }, { sessionId: "session-b" }),
      approvalScope({ token: "a" }, { tool: "other" }),
      approvalScope({ token: "a" }, { connector: approvedConnector({ allowTools: ["other"] }) }),
    ]) {
      const view = broker.begin(approvalScope({ token: "a" }));
      expect(broker.consume(view.id, changed, true)).toBe(false);
    }
    const expired = broker.begin(approvalScope({}));
    now = 110;
    expect(broker.consume(expired.id, approvalScope({}), true)).toBe(false);
    const controller = new AbortController();
    const aborted = broker.begin(approvalScope({}), controller.signal);
    controller.abort();
    expect(broker.consume(aborted.id, approvalScope({}), true)).toBe(false);
    broker.begin(approvalScope({}, { sessionId: "session-c" }));
    expect(broker.cancelSession("session-c")).toBe(1);
    for (let index = 0; index < 128; index += 1) {
      broker.begin(approvalScope({ index }, { sessionId: "queued-session" }));
    }
    expect(() => broker.begin(approvalScope({ overflow: true }))).toThrow(/queue is full/);
    expect(broker.cancelSession("queued-session")).toBe(128);
  });

  test("requires approval, revalidates grants, and executes one approved action", async () => {
    useTemporaryData();
    const live = approvedConnector({
      transport: "stdio",
      command: process.execPath,
      args: [join(import.meta.dir, "fixtures/connector-server.mjs")],
      url: undefined,
    });
    const sessionId = "direct-session";
    const execute = (approve?: () => Promise<boolean>) =>
      executeConnectorTool({
        sessionId,
        connectorId: "custom",
        tool: "write",
        args: { credential: "synthetic" },
        ...(approve ? { approve } : {}),
      });
    await saveConnectors([live]);
    await expect(execute()).rejects.toBeInstanceOf(ConnectorApprovalError);
    await expect(
      execute(async () => {
        await saveConnectors([approvedConnector({ allowTools: [] })]);
        return true;
      }),
    ).rejects.toThrow(/not allowed/);
    expect(cancelConnectorApprovals(sessionId)).toBe(0);
    await saveConnectors([live]);
    let approvals = 0;
    expect(
      await execute(async () => {
        approvals += 1;
        return true;
      }),
    ).toEqual({ content: [{ type: "text", text: "write:called" }] });
    expect(approvals).toBe(1);
  });
});
