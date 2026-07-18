import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "../../../frontend/node_modules/next/server";
import {
  connectorApprovalDigest,
  connectorApprovalBroker,
  createConnectorApprovalBroker,
} from "../../../services/agent-runtime/src/connector-approval";
import {
  type ConnectorApprovalView,
  type ConnectorArguments,
  type ConnectorConfig,
  type ConnectorRisk,
} from "../../../services/agent-runtime/src/connector-contract";
import {
  closePooledConnection,
  probeConnector,
} from "../../../services/agent-runtime/src/connector-pool";
import {
  listConnectors,
  upsertConnector,
} from "../../../services/agent-runtime/src/connectors-service";
import { resolveGoogleAccountFilePath } from "../../../services/agent-runtime/src/google-account";
import {
  catalogConnectorConfiguration,
  catalogConnectorMatchesOrigin,
  catalogConnectorRuntime,
  connectorToolPermissions,
  connectorToolRisk,
} from "../../../services/agent-runtime/src/connector-policy";
import {
  DELETE as removeConnectorHttp,
  GET as listConnectorsHttp,
  POST as saveConnectorHttp,
} from "../../../frontend/src/app/api/agent/connectors/route";
import {
  GET as listConnectorInventory,
  POST as callConnector,
} from "../../../frontend/src/app/api/agent/connectors/call/route";
import { POST as probeConnectorHttp } from "../../../frontend/src/app/api/agent/connectors/test/route";
import {
  DELETE as cancelApprovals,
  GET as listApprovals,
  POST as decideApproval,
} from "../../../frontend/src/app/api/agent/connectors/approvals/route";
import { POST as activatePlugin } from "../../../frontend/src/app/api/agent/plugins/[id]/route";
import { GET as listPlugins } from "../../../frontend/src/app/api/agent/plugins/route";
import {
  DELETE as disconnectGoogleAccountHttp,
  GET as getGoogleAccountHttp,
  PUT as saveGoogleClientHttp,
} from "../../../frontend/src/app/api/agent/accounts/google/route";
import {
  DELETE as cancelGoogleAuthorizationHttp,
  POST as beginGoogleAuthorizationHttp,
} from "../../../frontend/src/app/api/agent/accounts/google/authorize/route";

const key = Buffer.alloc(32, 7);
const approvalConfiguration: ConnectorConfig = {
  id: "github",
  name: "GitHub",
  transport: "http",
  url: "http://connector.test/mcp",
  allowTools: ["create_issue"],
  permissionReviewed: true,
  enabled: true,
};
const scope = {
  sessionId: "session-a",
  connectorId: "github",
  connectorName: "GitHub",
  tool: "create_issue",
  risk: "mutating",
  configuration: approvalConfiguration,
} satisfies {
  sessionId: string;
  connectorId: string;
  connectorName: string;
  tool: string;
  risk: ConnectorRisk;
  configuration: ConnectorConfig;
};

describe("connector approval authorization", () => {
  test("canonicalizes object order while retaining every JSON distinction", () => {
    const first = { nested: { b: 2, a: 1 }, items: [1, 2], value: null };
    const reordered = { value: null, items: [1, 2], nested: { a: 1, b: 2 } };
    const digest = (args: ConnectorArguments) => connectorApprovalDigest(key, { ...scope, args });
    expect(digest(first)).toEqual(digest(reordered));
    expect(digest(first)).not.toEqual(digest({ ...reordered, items: [2, 1] }));
    expect(digest(first)).not.toEqual(digest({ nested: reordered.nested, items: [1, 2] }));
    expect(digest({ value: 1 })).not.toEqual(digest({ value: "1" }));
  });

  test("binds hidden credential changes and exposes no raw values", () => {
    const broker = createConnectorApprovalBroker({ key, ttlMs: 1_000 });
    const firstInput = { ...scope, args: { token: "secret-a", body: "hello" } };
    const secondInput = { ...scope, args: { token: "secret-b", body: "hello" } };
    const first = broker.begin(firstInput);
    const second = broker.begin(secondInput);
    expect(connectorApprovalDigest(key, firstInput)).not.toEqual(
      connectorApprovalDigest(key, secondInput),
    );
    expect(JSON.stringify(first.approval.argument_summary)).not.toContain("secret-a");
    expect(JSON.stringify(first.approval.argument_summary)).not.toContain("hello");
    broker.cancel(first.approval.id);
    broker.cancel(second.approval.id);
    const audit = JSON.stringify(broker.audit());
    expect(audit).not.toContain("secret-a");
    expect(audit).not.toContain("secret-b");
    expect(audit).not.toContain("hello");
  });

  test("binds approvals to the complete connector configuration", () => {
    const input = { ...scope, args: { title: "one" } };
    expect(connectorApprovalDigest(key, input)).not.toEqual(
      connectorApprovalDigest(key, {
        ...input,
        configuration: {
          ...input.configuration,
          headers: { Authorization: "Bearer changed-after-review" },
        },
      }),
    );
  });

  test("requires exact scope and arguments and consumes approval once", async () => {
    const broker = createConnectorApprovalBroker({ key, ttlMs: 1_000 });
    const input = { ...scope, args: { title: "one", nested: { credential: "alpha" } } };
    const request = broker.begin(input);
    expect(broker.decide(request.approval.id, "approve")).toBe(true);
    expect(await request.wait).toBe("approved");
    expect(broker.consume(request.approval.id, { ...input, sessionId: "session-b" })).toBe(false);

    const changed = broker.begin(input);
    broker.decide(changed.approval.id, "approve");
    await changed.wait;
    expect(
      broker.consume(changed.approval.id, {
        ...input,
        args: { title: "two", nested: { credential: "alpha" } },
      }),
    ).toBe(false);

    const exact = broker.begin(input);
    broker.decide(exact.approval.id, "approve");
    await exact.wait;
    expect(broker.consume(exact.approval.id, input)).toBe(true);
    expect(broker.consume(exact.approval.id, input)).toBe(false);
  });

  test("denies, expires, and cancels pending requests fail closed", async () => {
    let now = 10;
    const broker = createConnectorApprovalBroker({ key, ttlMs: 20, now: () => now });
    const denied = broker.begin({ ...scope, args: {} });
    broker.decide(denied.approval.id, "deny");
    expect(await denied.wait).toBe("denied");

    const expired = broker.begin({ ...scope, args: {} });
    now = 31;
    broker.expireDue();
    expect(await expired.wait).toBe("expired");

    const cancelled = broker.begin({ ...scope, args: {} });
    broker.cancelSession(scope.sessionId);
    expect(await cancelled.wait).toBe("cancelled");
    expect(broker.audit()).toHaveLength(3);
  });

  test("checks expiry directly when deciding and consuming", async () => {
    let now = 100;
    const broker = createConnectorApprovalBroker({ key, ttlMs: 20, now: () => now });
    const decision = broker.begin({ ...scope, args: {} });
    now = 120;
    expect(broker.decide(decision.approval.id, "approve")).toBe(false);
    expect(await decision.wait).toBe("expired");

    now = 200;
    const consumption = broker.begin({ ...scope, args: {} });
    expect(broker.decide(consumption.approval.id, "approve")).toBe(true);
    now = 220;
    expect(broker.consume(consumption.approval.id, { ...scope, args: {} })).toBe(false);
    expect(broker.audit().map((entry) => entry.outcome)).toEqual(["expired", "expired"]);
  });

  test("stages bounded idempotent decisions without settling before armed release", () => {
    let now = 100;
    const broker = createConnectorApprovalBroker({ key, ttlMs: 10_000, now: () => now });
    const approval = broker.begin({ ...scope, args: {} });
    const transactionId = randomUUID();
    expect(broker.prepareDecision(transactionId, approval.approval.id, "approve")).toBe(true);
    expect(broker.prepareDecision(transactionId, approval.approval.id, "approve")).toBe(true);
    expect(broker.prepareDecision(transactionId, approval.approval.id, "deny")).toBe(false);
    expect(broker.commitPreparedDecision(transactionId)).toBe(false);
    expect(broker.armPreparedDecision(transactionId)).toBe(true);
    expect(broker.armPreparedDecision(transactionId)).toBe(true);
    expect(broker.pending().map((entry) => entry.id)).toContain(approval.approval.id);
    now += 5_001;
    expect(broker.commitPreparedDecision(transactionId)).toBe(false);
    expect(broker.pending().map((entry) => entry.id)).toContain(approval.approval.id);
    broker.cancel(approval.approval.id);
  });

  test("denies embedded desktop HTTP listing and decisions while retaining cancellation", async () => {
    const previousDesktop = process.env.LOCAL_STUDIO_DESKTOP;
    const sessionId = `desktop-http-${randomUUID()}`;
    const pending = connectorApprovalBroker.begin({ ...scope, sessionId, args: {} });
    process.env.LOCAL_STUDIO_DESKTOP = "1";
    try {
      const listResponse = listApprovals(
        new NextRequest("http://127.0.0.1/api/agent/connectors/approvals"),
      );
      expect(listResponse.status).toBe(403);
      expect(await listResponse.text()).not.toContain(pending.approval.id);

      const decisionResponse = await decideApproval(
        new NextRequest("http://127.0.0.1/api/agent/connectors/approvals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ request_id: pending.approval.id, decision: "approve" }),
        }),
      );
      expect(decisionResponse.status).toBe(403);
      expect(
        connectorApprovalBroker.pending().some((approval) => approval.id === pending.approval.id),
      ).toBe(true);

      const cancelResponse = cancelApprovals(
        new NextRequest(
          `http://127.0.0.1/api/agent/connectors/approvals?session_id=${encodeURIComponent(sessionId)}`,
          { method: "DELETE" },
        ),
      );
      expect(cancelResponse.status).toBe(200);
      expect(await pending.wait).toBe("cancelled");
    } finally {
      connectorApprovalBroker.cancel(pending.approval.id);
      if (previousDesktop === undefined) delete process.env.LOCAL_STUDIO_DESKTOP;
      else process.env.LOCAL_STUDIO_DESKTOP = previousDesktop;
    }
  });

  test("retains non-desktop HTTP listing and decision behavior", async () => {
    const previousDesktop = process.env.LOCAL_STUDIO_DESKTOP;
    const sessionId = `web-http-${randomUUID()}`;
    const pending = connectorApprovalBroker.begin({ ...scope, sessionId, args: {} });
    delete process.env.LOCAL_STUDIO_DESKTOP;
    try {
      const listResponse = listApprovals(
        new NextRequest("http://127.0.0.1/api/agent/connectors/approvals"),
      );
      expect(listResponse.status).toBe(200);
      expect(await listResponse.text()).toContain(pending.approval.id);

      const decisionResponse = await decideApproval(
        new NextRequest("http://127.0.0.1/api/agent/connectors/approvals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ request_id: pending.approval.id, decision: "approve" }),
        }),
      );
      expect(decisionResponse.status).toBe(200);
      expect(await pending.wait).toBe("approved");
    } finally {
      connectorApprovalBroker.cancel(pending.approval.id);
      if (previousDesktop === undefined) delete process.env.LOCAL_STUDIO_DESKTOP;
      else process.env.LOCAL_STUDIO_DESKTOP = previousDesktop;
    }
  });

  test("denies all embedded connector management HTTP methods", async () => {
    const previousDesktop = process.env.LOCAL_STUDIO_DESKTOP;
    process.env.LOCAL_STUDIO_DESKTOP = "1";
    try {
      expect(
        (await listConnectorsHttp(new NextRequest("http://127.0.0.1/api/agent/connectors"))).status,
      ).toBe(403);
      expect(
        (
          await saveConnectorHttp(
            new NextRequest("http://127.0.0.1/api/agent/connectors", {
              method: "POST",
              body: JSON.stringify({
                id: "github",
                catalogId: "github",
                env: { PATH: "/tmp/hostile" },
                allowTools: ["create_issue"],
                permissionReviewed: true,
                enabled: true,
              }),
            }),
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await removeConnectorHttp(
            new NextRequest("http://127.0.0.1/api/agent/connectors?id=github", {
              method: "DELETE",
            }),
          )
        ).status,
      ).toBe(403);
    } finally {
      if (previousDesktop === undefined) delete process.env.LOCAL_STUDIO_DESKTOP;
      else process.env.LOCAL_STUDIO_DESKTOP = previousDesktop;
    }
  });

  test("uses only first-party catalog policy and binds it to the executable", () => {
    const github = catalogConnectorConfiguration({
      id: "github",
      catalogId: "github",
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "token" },
      allowTools: ["search_repositories", "create_issue"],
      permissionReviewed: true,
      enabled: true,
    });
    expect(catalogConnectorMatchesOrigin(github)).toBe(true);
    const runtime = catalogConnectorRuntime(github);
    expect(runtime).not.toBeNull();
    expect(runtime?.env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe("token");
    expect(runtime?.env.NODE_OPTIONS).toBeUndefined();
    expect(runtime?.env.npm_config_prefix).toBeUndefined();
    expect(runtime?.cwd).not.toBe(process.cwd());
    expect(runtime?.env.HOME).toBe(runtime?.cwd);
    expect(connectorToolRisk(github, "search_repositories")).toBe("read");
    expect(connectorToolRisk(github, "create_issue")).toBe("mutating");
    expect(connectorToolRisk(github, "new_tool")).toBe("critical");
    expect(catalogConnectorMatchesOrigin({ ...github, command: "other" })).toBe(false);
    expect(connectorToolRisk({ ...github, command: "other" }, "search_repositories")).toBe(
      "critical",
    );
    expect(
      catalogConnectorMatchesOrigin({
        ...github,
        env: { ...github.env, PATH: "/tmp", NODE_OPTIONS: "--require=/tmp/evil" },
      }),
    ).toBe(false);
    expect(catalogConnectorMatchesOrigin({ ...github, cwd: "/tmp" })).toBe(false);
    expect(catalogConnectorMatchesOrigin({ ...github, args: ["--hostile"] })).toBe(false);
    expect(
      catalogConnectorMatchesOrigin({
        ...github,
        origin: { ...github.origin, version: "hostile" },
      }),
    ).toBe(false);

    const computer = catalogConnectorConfiguration({
      id: "computer",
      catalogId: "computer",
      env: { SSH_HOST: "user@example" },
      allowTools: ["run_command"],
      permissionReviewed: true,
      enabled: true,
    });
    expect(catalogConnectorMatchesOrigin(computer)).toBe(true);
    expect(catalogConnectorMatchesOrigin({ ...computer, args: ["/tmp/ssh-remote.mjs"] })).toBe(
      false,
    );
    expect(connectorToolRisk(computer, "run_command")).toBe("critical");

    const generic: ConnectorConfig = {
      ...github,
      id: "generic",
      origin: { kind: "plugin", id: "generic" },
    };
    expect(
      connectorToolPermissions(generic, [
        { name: "claimed_read", annotations: { readOnlyHint: true } },
      ])[0]?.risk,
    ).toBe("critical");
  });
});

type FakeCall = {
  id: number;
  method: string;
  tool?: string;
};

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
  if (tool !== undefined && typeof tool !== "string") throw new Error("Invalid fake MCP tool");
  return { id, method, ...(tool ? { tool } : {}) };
}

function isInitializedNotification(input: unknown): boolean {
  if (input === null || typeof input !== "object") return false;
  return (
    Reflect.get(input, "id") === undefined &&
    Reflect.get(input, "method") === "notifications/initialized"
  );
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

describe("connector call route", () => {
  let dataDir: string;
  let pluginRoot: string;
  const calls: string[] = [];
  const requests: FakeCall[] = [];
  const previousDataDir = process.env.LOCAL_STUDIO_DATA_DIR;
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
    globalThis.fetch = async (input, init) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (
        url !== "http://connector.test/mcp" &&
        url !== "http://plugin.test/mcp" &&
        url !== "http://probe-failure.test/mcp"
      ) {
        return originalFetch(input, init);
      }
      if (typeof init?.body !== "string") throw new Error("Fake MCP request body is missing");
      const body: unknown = JSON.parse(init.body);
      if (isInitializedNotification(body)) return new Response(null, { status: 202 });
      const message = fakeCall(body);
      requests.push(message);
      if (url === "http://probe-failure.test/mcp") {
        return Response.json({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32_000, message: "credential secret-from-probe" },
        });
      }
      if (message.method === "tools/call" && message.tool) calls.push(message.tool);
      if (message.method === "tools/call" && message.tool === "search_repositories") {
        return Response.json({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32_000, message: "credential secret-from-connector" },
        });
      }
      const result =
        message.method === "tools/list"
          ? {
              tools:
                url === "http://plugin.test/mcp"
                  ? [
                      {
                        name: "observe",
                        inputSchema: { type: "object" },
                        annotations: { readOnlyHint: true },
                      },
                    ]
                  : [
                      { name: "search_repositories", inputSchema: { type: "object" } },
                      { name: "create_issue", inputSchema: { type: "object" } },
                    ],
            }
          : message.method === "tools/call"
            ? { content: [{ type: "text", text: message.tool ?? "" }] }
            : {
                protocolVersion: "2025-03-26",
                capabilities: {},
                serverInfo: { name: "fake", version: "1.0.0" },
              };
      return Response.json({ jsonrpc: "2.0", id: message.id, result });
    };
    dataDir = await mkdtemp(join(tmpdir(), "local-studio-connector-approval-"));
    process.env.LOCAL_STUDIO_DATA_DIR = dataDir;
    pluginRoot = join(dataDir, "plugins", "fixture-plugin");
    await mkdir(join(pluginRoot, ".codex-plugin"), { recursive: true });
    await writeFile(
      join(pluginRoot, ".codex-plugin", "plugin.json"),
      JSON.stringify({ name: "fixture-plugin", version: "1.0.0", mcpServers: "./mcp.json" }),
    );
    await writeFile(
      join(pluginRoot, "mcp.json"),
      JSON.stringify({
        mcpServers: { fixture: { type: "http", url: "http://plugin.test/mcp" } },
      }),
    );
    await writeFile(
      join(dataDir, "connectors.json"),
      JSON.stringify({
        connectors: [
          {
            id: "github",
            name: "GitHub",
            transport: "http",
            url: "http://connector.test/mcp",
            allowTools: ["search_repositories", "create_issue"],
            permissionReviewed: true,
            enabled: true,
          },
        ],
      }),
    );
  });

  afterAll(async () => {
    closePooledConnection("github");
    globalThis.fetch = originalFetch;
    await rm(dataDir, { recursive: true, force: true });
    if (previousDataDir === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
    else process.env.LOCAL_STUDIO_DATA_DIR = previousDataDir;
  });

  const request = (
    sessionId: string,
    tool: string,
    args: ConnectorArguments = {},
    signal?: AbortSignal,
  ) =>
    new Request("http://localhost/api/agent/connectors/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, connector_id: "github", tool, args }),
      signal,
    });

  test("denies every embedded settings HTTP path before parsing or side effects", async () => {
    const previousDesktop = process.env.LOCAL_STUDIO_DESKTOP;
    const connectorsFile = join(dataDir, "connectors.json");
    const originalConnectors = await readFile(connectorsFile);
    const github = (await listConnectors()).find((connector) => connector.id === "github");
    if (!github) throw new Error("GitHub connector fixture is missing");
    const accountFile = resolveGoogleAccountFilePath();
    const originalAccount = existsSync(accountFile) ? await readFile(accountFile) : null;
    const staleConnectors = JSON.stringify({
      connectors: [
        github,
        {
          id: "plugin-fixture-stale",
          name: "Fixture stale",
          transport: "http",
          url: "http://plugin.test/mcp",
          allowTools: ["observe"],
          permissionReviewed: true,
          origin: { kind: "plugin", id: "fixture-plugin", version: "0.0.0" },
          enabled: true,
        },
      ],
    });
    await writeFile(connectorsFile, staleConnectors);
    const requestCount = requests.length;
    process.env.LOCAL_STUDIO_DESKTOP = "1";
    try {
      expect(
        (
          await probeConnectorHttp(
            new NextRequest("http://127.0.0.1/api/agent/connectors/test", {
              method: "POST",
              body: JSON.stringify({ id: "plugin-fixture-stale" }),
            }),
          )
        ).status,
      ).toBe(403);
      expect(
        (await listPlugins(new NextRequest("http://127.0.0.1/api/agent/plugins"))).status,
      ).toBe(403);
      expect(
        (
          await activatePlugin(
            new NextRequest("http://127.0.0.1/api/agent/plugins/fixture-plugin", {
              method: "POST",
              body: JSON.stringify({ enabled: false }),
            }),
            { params: Promise.resolve({ id: "fixture-plugin" }) },
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await getGoogleAccountHttp(
            new NextRequest("http://127.0.0.1/api/agent/accounts/google"),
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await saveGoogleClientHttp(
            new NextRequest("http://127.0.0.1/api/agent/accounts/google", {
              method: "PUT",
              body: JSON.stringify({ clientId: "desktop-client", clientSecret: "not-a-secret" }),
            }),
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await disconnectGoogleAccountHttp(
            new NextRequest("http://127.0.0.1/api/agent/accounts/google", {
              method: "DELETE",
              body: JSON.stringify({ account: "gmail" }),
            }),
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await beginGoogleAuthorizationHttp(
            new NextRequest("http://127.0.0.1/api/agent/accounts/google/authorize", {
              method: "POST",
              body: JSON.stringify({ account: "gmail" }),
            }),
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await cancelGoogleAuthorizationHttp(
            new NextRequest("http://127.0.0.1/api/agent/accounts/google/authorize", {
              method: "DELETE",
              body: JSON.stringify({ account: "gmail" }),
            }),
          )
        ).status,
      ).toBe(403);
      expect(await readFile(connectorsFile, "utf8")).toBe(staleConnectors);
      expect(requests).toHaveLength(requestCount);
      expect(existsSync(accountFile)).toBe(originalAccount !== null);
      if (originalAccount) expect(await readFile(accountFile)).toEqual(originalAccount);
    } finally {
      await writeFile(connectorsFile, originalConnectors);
      closePooledConnection("plugin-fixture-stale");
      if (previousDesktop === undefined) delete process.env.LOCAL_STUDIO_DESKTOP;
      else process.env.LOCAL_STUDIO_DESKTOP = previousDesktop;
    }
  });

  test("blocks mutation until decision and never calls after denial", async () => {
    const deniedResponse = callConnector(request("denied-session", "create_issue", { title: "x" }));
    const denied = await pendingApproval("denied-session");
    expect(calls).not.toContain("create_issue");
    connectorApprovalBroker.decide(denied.id, "deny");
    expect((await deniedResponse).status).toBe(403);
    expect(calls).not.toContain("create_issue");

    const approvedResponse = callConnector(
      request("approved-session", "create_issue", { title: "x" }),
    );
    const approved = await pendingApproval("approved-session");
    connectorApprovalBroker.decide(approved.id, "approve");
    expect((await approvedResponse).status).toBe(200);
    expect(calls.filter((tool) => tool === "create_issue")).toHaveLength(1);
  });

  test("cancels a pending mutation when the agent request aborts", async () => {
    const controller = new AbortController();
    const response = callConnector(
      request("cancelled-session", "create_issue", { title: "cancel" }, controller.signal),
    );
    await pendingApproval("cancelled-session");
    controller.abort();
    expect((await response).status).toBe(403);
    expect(calls.filter((tool) => tool === "create_issue")).toHaveLength(1);
  });

  test("rejects a newly advertised tool outside the explicit grant", async () => {
    const response = await callConnector(request("drift-session", "new_tool"));
    expect(response.status).toBe(403);
    expect(connectorApprovalBroker.pending()).toHaveLength(0);
  });

  test("invalidates approval when connector configuration changes", async () => {
    const response = callConnector(
      request("configuration-drift-session", "create_issue", { title: "drift" }),
    );
    const approval = await pendingApproval("configuration-drift-session");
    await writeFile(
      join(dataDir, "connectors.json"),
      JSON.stringify({
        connectors: [
          {
            id: "github",
            name: "GitHub",
            transport: "http",
            url: "http://connector.test/mcp",
            headers: { Authorization: "Bearer changed-after-review" },
            allowTools: ["search_repositories", "create_issue"],
            permissionReviewed: true,
            enabled: true,
          },
        ],
      }),
    );
    closePooledConnection("github");
    connectorApprovalBroker.decide(approval.id, "approve");
    const result = await response;
    expect(result.status).toBe(403);
    expect(calls.filter((tool) => tool === "create_issue")).toHaveLength(1);
  });

  test("replaces connector failure details with a stable error", async () => {
    const response = callConnector(request("failure-session", "search_repositories"));
    const approval = await pendingApproval("failure-session");
    connectorApprovalBroker.decide(approval.id, "approve");
    const result = await response;
    expect(result.status).toBe(500);
    expect(await result.json()).toEqual({ ok: false, error: "Connector tool call failed" });

    const probe = await probeConnector({
      id: "failure-probe",
      name: "Failure probe",
      transport: "http",
      url: "http://probe-failure.test/mcp",
      allowTools: [],
      permissionReviewed: false,
      enabled: false,
    });
    expect(probe).toEqual({ ok: false, tools: [], error: "Connector probe failed" });
    expect(JSON.stringify(probe)).not.toContain("secret-from-probe");
  });

  test("requires an explicit reviewed grant before enabling plugin tools", async () => {
    const activation = () =>
      activatePlugin(
        new Request("http://localhost/api/agent/plugins/fixture-plugin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: true }),
        }),
        { params: Promise.resolve({ id: "fixture-plugin" }) },
      );
    const reviewRequired = await activation();
    expect(reviewRequired.status).toBe(409);
    expect(await reviewRequired.json()).toEqual({
      error: "Review connector tool permissions before enabling this plugin",
    });
    const pending = (await listConnectors()).find(
      (connector) => connector.origin?.id === "fixture-plugin",
    );
    expect(pending).toMatchObject({
      allowTools: [],
      permissionReviewed: false,
      enabled: false,
    });
    if (!pending) throw new Error("Plugin connector was not staged for review");
    await upsertConnector({
      ...pending,
      allowTools: ["observe"],
      permissionReviewed: true,
      enabled: false,
    });
    expect((await activation()).status).toBe(200);
    expect((await listConnectors()).find((connector) => connector.id === pending.id)).toMatchObject(
      {
        allowTools: ["observe"],
        permissionReviewed: true,
        enabled: true,
      },
    );

    await writeFile(
      join(pluginRoot, ".codex-plugin", "plugin.json"),
      JSON.stringify({ name: "fixture-plugin", version: "2.0.0", mcpServers: "./mcp.json" }),
    );
    await writeFile(join(pluginRoot, "mcp.json"), "invalid");
    expect((await listPlugins(new Request("http://localhost/api/agent/plugins"))).status).toBe(200);
    expect((await listConnectors()).find((connector) => connector.id === pending.id)).toMatchObject(
      {
        allowTools: [],
        permissionReviewed: false,
        enabled: false,
      },
    );
  });

  test("keeps connector inventory and calls free of configuration writes", async () => {
    const connectorsFile = join(dataDir, "connectors.json");
    const originalConnectors = await readFile(connectorsFile);
    const stored = JSON.stringify({
      connectors: [
        {
          id: "plugin-fixture-stale",
          name: "Fixture stale",
          transport: "http",
          url: "http://plugin.test/mcp",
          allowTools: ["observe", "observe"],
          permissionReviewed: true,
          origin: { kind: "plugin", id: "fixture-plugin", version: "1.0.0" },
          enabled: true,
        },
      ],
    });
    await writeFile(connectorsFile, stored);
    try {
      const inventory = await listConnectorInventory(
        new NextRequest("http://127.0.0.1/api/agent/connectors/call"),
      );
      expect(inventory.status).toBe(200);
      expect(await readFile(connectorsFile, "utf8")).toBe(stored);

      const response = callConnector(
        new NextRequest("http://127.0.0.1/api/agent/connectors/call", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: "non-mutating-call",
            connector_id: "plugin-fixture-stale",
            tool: "observe",
            args: {},
          }),
        }),
      );
      const approval = await pendingApproval("non-mutating-call");
      connectorApprovalBroker.decide(approval.id, "approve");
      expect((await response).status).toBe(200);
      expect(await readFile(connectorsFile, "utf8")).toBe(stored);
    } finally {
      closePooledConnection("plugin-fixture-stale");
      await writeFile(connectorsFile, originalConnectors);
    }
  });
});
