import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Effect } from "../../../frontend/node_modules/effect/dist/index.js";
import {
  createConnectorApprovalProcessClient,
  type ConnectorApprovalProcessTransport,
} from "../../../frontend/desktop/logic/connector-approval-ipc-client";
import {
  decodeConnectorApprovalDecisionBridgeInput,
  decodeConnectorApprovalListBridgeInput,
  decodeConnectorApprovalProcessRequest,
  decodeConnectorApprovalProcessResponse,
  decodeConnectorProbeBridgeInput,
  decodeGitHubArtifactInstallBridgeInput,
  decodeGitHubArtifactStatusBridgeInput,
  decodeGoogleAccountOperationBridgeInput,
  decodeGoogleClientSaveBridgeInput,
  decodePluginListBridgeInput,
  decodePluginSetEnabledBridgeInput,
  decodeConnectorRemoveBridgeInput,
  decodeConnectorSaveBridgeInput,
  type ConnectorApprovalProcessRequest,
  type ConnectorApprovalProcessResponse,
} from "../../../frontend/desktop/logic/connector-approval-ipc-contract";
import {
  allowsConnectorApprovalSender,
  allowsConnectorManagementSender,
  type ConnectorApprovalSenderInput,
} from "../../../frontend/desktop/logic/connector-approval-ipc-sender";
import {
  registerConnectorApprovalProcessIpc,
  type ConnectorApprovalProcessHost,
  type ConnectorManagementPort,
} from "../../../frontend/src/instrumentation-connector-approvals";
import { createConnectorApprovalBroker } from "../../../services/agent-runtime/src/connector-approval";
import { decodeConnectorUpsertPayload } from "../../../services/agent-runtime/src/connectors-service";
import { getManagedGoogleAccount } from "../../../frontend/src/features/integrations/google-account-model";

class FakeProcessHost implements ConnectorApprovalProcessHost {
  readonly identity = {};
  readonly listeners = new Set<(message: unknown) => void>();
  readonly closeListeners = new Set<() => void>();
  readonly sent: ConnectorApprovalProcessResponse[] = [];
  isConnected = true;
  dropResponses = false;
  responseSink: (message: unknown) => void = () => undefined;

  connected(): boolean {
    return this.isConnected;
  }

  listen(listener: (message: unknown) => void): void {
    this.listeners.add(listener);
  }

  listenClose(listener: () => void): void {
    this.closeListeners.add(listener);
  }

  send(message: ConnectorApprovalProcessResponse): void {
    this.sent.push(message);
    if (!this.dropResponses) this.responseSink(message);
  }

  receive(message: unknown): void {
    this.listeners.forEach((listener) => listener(message));
  }

  disconnect(): void {
    this.isConnected = false;
    this.closeListeners.forEach((listener) => listener());
  }
}

class FakeProcessTransport implements ConnectorApprovalProcessTransport {
  readonly sent: ConnectorApprovalProcessRequest[] = [];
  isConnected = true;
  callbackError = false;
  forward: (message: ConnectorApprovalProcessRequest) => void = () => undefined;
  private messageListener: (message: unknown) => void = () => undefined;
  private closeListener: () => void = () => undefined;

  connected(): boolean {
    return this.isConnected;
  }

  send(message: ConnectorApprovalProcessRequest, callback: (error: Error | null) => void): void {
    this.sent.push(message);
    if (!this.isConnected) {
      callback(new Error("disconnected"));
      return;
    }
    this.forward(message);
    callback(this.callbackError ? new Error("late callback failure") : null);
  }

  listen(onMessage: (message: unknown) => void, onClose: () => void): () => void {
    this.messageListener = onMessage;
    this.closeListener = onClose;
    return () => {
      this.messageListener = () => undefined;
      this.closeListener = () => undefined;
    };
  }

  respond(message: unknown): void {
    this.messageListener(message);
  }

  disconnect(): void {
    this.isConnected = false;
    this.closeListener();
  }
}

const approvalInput = {
  sessionId: "desktop-ipc-session",
  connectorId: "github",
  connectorName: "GitHub",
  tool: "create_issue",
  risk: "mutating" as const,
  args: { title: "issue" },
  configuration: {
    id: "github",
    name: "GitHub",
    transport: "http" as const,
    url: "http://connector.test/mcp",
    allowTools: ["create_issue"],
    permissionReviewed: true,
    enabled: true,
  },
};

const githubArtifactStatusResponse = {
  version: "1.6.0",
  target: "darwin-arm64",
  state: "not-installed" as const,
};

const emptyManagement: ConnectorManagementPort = {
  list: async () => ({ connectors: [] }),
  save: async () => ({ connectors: [] }),
  remove: async () => ({ connectors: [] }),
  probe: async () => ({
    ok: true,
    tool_count: 0,
    tool_names: [],
    tools: [],
    inventory_digest: "sha256:empty",
  }),
  listPlugins: async () => ({ plugins: [] }),
  setPluginEnabled: async () => ({ plugins: [] }),
  githubArtifactStatus: async () => githubArtifactStatusResponse,
  installGitHubArtifact: async () => githubArtifactStatusResponse,
  getGoogleAccount: async () => googleAccountResponse,
  saveGoogleClient: async () => googleAccountResponse,
  disconnectGoogleAccount: async () => googleAccountResponse,
  beginGoogleAuthorization: async () => ({ authorizationUrl: "https://accounts.test/authorize" }),
  cancelGoogleAuthorization: async () => ({ cancelled: true }),
};

const googleConnection = {
  connected: false,
  email: null,
  scopes: [],
  resource: "https://google.test",
  connectedAt: null,
};

const googleAccountResponse = {
  account: {
    configured: false,
    clientId: null,
    hasClientSecret: false,
    connections: { gmail: googleConnection, "google-calendar": googleConnection },
  },
};

function linkedClient(
  host: FakeProcessHost,
  timeoutMs = 100,
): ReturnType<typeof createConnectorApprovalProcessClient> {
  const transport = new FakeProcessTransport();
  transport.forward = (message) => host.receive(message);
  host.responseSink = (message) => transport.respond(message);
  return createConnectorApprovalProcessClient(transport, timeoutMs);
}

describe("desktop connector private IPC", () => {
  test("allows only trusted current app main frames", () => {
    const mainWindow = {};
    const quickPanelWindow = {};
    const mainFrame = {};
    const input: ConnectorApprovalSenderInput = {
      currentFrontendUrl: "http://127.0.0.1:43821",
      mainWindow,
      quickPanelWindow,
      senderWindow: mainWindow,
      senderFrame: mainFrame,
      mainFrame,
      senderUrl: "http://127.0.0.1:43821/agent",
      senderDestroyed: false,
      senderWindowDestroyed: false,
    };
    expect(allowsConnectorApprovalSender(input)).toBe(true);
    expect(allowsConnectorApprovalSender({ ...input, senderWindow: quickPanelWindow })).toBe(true);
    expect(allowsConnectorManagementSender(input)).toBe(true);
    expect(allowsConnectorManagementSender({ ...input, senderWindow: quickPanelWindow })).toBe(
      false,
    );
    expect(allowsConnectorApprovalSender({ ...input, senderWindow: {} })).toBe(false);
    expect(allowsConnectorApprovalSender({ ...input, senderFrame: {} })).toBe(false);
    expect(
      allowsConnectorApprovalSender({ ...input, senderUrl: "http://127.0.0.1:43822/agent" }),
    ).toBe(false);
    expect(allowsConnectorApprovalSender({ ...input, senderDestroyed: true })).toBe(false);
  });

  test("requires exact bridge and process schemas and one listener per child", () => {
    expect(decodeConnectorApprovalListBridgeInput("list")).toBe("list");
    expect(() => decodeConnectorApprovalListBridgeInput({ operation: "list" })).toThrow();
    expect(() =>
      decodeConnectorApprovalDecisionBridgeInput({
        request_id: randomUUID(),
        decision: "approve",
        extra: true,
      }),
    ).toThrow();
    expect(() => decodeConnectorSaveBridgeInput({ payload: "{}" })).toThrow();
    expect(() => decodeConnectorRemoveBridgeInput({ id: "github", extra: true })).toThrow();
    expect(decodeConnectorProbeBridgeInput({ id: "github" })).toEqual({ id: "github" });
    expect(() => decodeConnectorProbeBridgeInput({ id: "github", extra: true })).toThrow();
    expect(decodePluginListBridgeInput("list")).toBe("list");
    expect(() => decodePluginSetEnabledBridgeInput({ id: "github", enabled: "yes" })).toThrow();
    expect(decodeGitHubArtifactStatusBridgeInput("status")).toBe("status");
    expect(() => decodeGitHubArtifactStatusBridgeInput("install")).toThrow();
    expect(decodeGitHubArtifactInstallBridgeInput("install")).toBe("install");
    expect(() => decodeGitHubArtifactInstallBridgeInput("status")).toThrow();
    expect(decodeGoogleClientSaveBridgeInput('{"clientId":"client"}')).toBe(
      '{"clientId":"client"}',
    );
    expect(() => decodeGoogleAccountOperationBridgeInput({ account: "drive" })).toThrow();
    expect(() =>
      decodeConnectorApprovalProcessRequest({
        channel: "local-studio:desktop-private:request",
        id: randomUUID(),
        operation: "list-connectors",
        extra: true,
      }),
    ).toThrow();

    const host = new FakeProcessHost();
    const broker = createConnectorApprovalBroker();
    registerConnectorApprovalProcessIpc(host, broker, emptyManagement);
    registerConnectorApprovalProcessIpc(host, broker, emptyManagement);
    expect(host.listeners.size).toBe(1);
    expect(host.closeListeners.size).toBe(1);
  });

  test("correlates exact responses and fails closed on malformed and disconnected children", async () => {
    const transport = new FakeProcessTransport();
    const client = createConnectorApprovalProcessClient(transport, 100);
    const listed = Effect.runPromise(client.list());
    const request = transport.sent.at(-1);
    if (!request) throw new Error("Private request was not sent");
    transport.respond({
      channel: "local-studio:desktop-private:response",
      id: request.id,
      operation: "list-approvals",
      ok: true,
      result: { approvals: [] },
    });
    expect(await listed).toEqual({ approvals: [] });

    const malformed = Effect.runPromise(client.list());
    const malformedRequest = transport.sent.at(-1);
    if (!malformedRequest) throw new Error("Private request was not sent");
    transport.respond({
      channel: "local-studio:desktop-private:response",
      id: malformedRequest.id,
      operation: "list-approvals",
      ok: true,
      result: { approvals: [] },
      extra: true,
    });
    await expect(malformed).rejects.toThrow("invalid private response");
    await expect(Effect.runPromise(client.list())).rejects.toThrow("unavailable");

    const disconnectedTransport = new FakeProcessTransport();
    const disconnectedClient = createConnectorApprovalProcessClient(disconnectedTransport, 100);
    const disconnected = Effect.runPromise(disconnectedClient.list());
    disconnectedTransport.disconnect();
    await expect(disconnected).rejects.toThrow("disconnected");
  });

  test("allows artifact installation to outlive the ordinary private request timeout", async () => {
    const transport = new FakeProcessTransport();
    const client = createConnectorApprovalProcessClient(transport, 5);
    const installing = Effect.runPromise(client.installGitHubArtifact());
    const request = transport.sent.at(-1);
    if (!request) throw new Error("Private request was not sent");
    await new Promise((resolve) => setTimeout(resolve, 10));
    const result = JSON.stringify({ ...githubArtifactStatusResponse, state: "installed" });
    transport.respond({
      channel: "local-studio:desktop-private:response",
      id: request.id,
      operation: "install-github-artifact",
      ok: true,
      result,
    });
    expect(await installing).toBe(result);
    client.close();
  });

  test("keeps approvals pending when prepare or arm acknowledgements are lost", async () => {
    const host = new FakeProcessHost();
    const broker = createConnectorApprovalBroker();
    registerConnectorApprovalProcessIpc(host, broker, emptyManagement);
    const client = linkedClient(host, 5);
    const prepared = broker.begin(approvalInput);
    host.dropResponses = true;
    const transactionId = randomUUID();
    await expect(
      Effect.runPromise(client.prepareDecision(transactionId, prepared.approval.id, "approve")),
    ).rejects.toThrow("timed out");
    await Effect.runPromise(client.cancelDecision(transactionId));
    expect(broker.pending().map((approval) => approval.id)).toContain(prepared.approval.id);

    host.dropResponses = false;
    const armed = broker.begin({ ...approvalInput, sessionId: "arm-loss" });
    const armedTransaction = randomUUID();
    await Effect.runPromise(client.prepareDecision(armedTransaction, armed.approval.id, "approve"));
    host.dropResponses = true;
    await expect(Effect.runPromise(client.armDecision(armedTransaction))).rejects.toThrow(
      "timed out",
    );
    await Effect.runPromise(client.cancelDecision(armedTransaction));
    await Effect.runPromise(client.commitDecision(armedTransaction));
    expect(broker.pending().map((approval) => approval.id)).toContain(armed.approval.id);

    broker.cancel(prepared.approval.id);
    broker.cancel(armed.approval.id);
  });

  test("cancels staged transactions on child disconnect and releases only after arm", async () => {
    const host = new FakeProcessHost();
    const broker = createConnectorApprovalBroker();
    registerConnectorApprovalProcessIpc(host, broker, emptyManagement);
    const client = linkedClient(host);
    const disconnected = broker.begin(approvalInput);
    const disconnectedTransaction = randomUUID();
    await Effect.runPromise(
      client.prepareDecision(disconnectedTransaction, disconnected.approval.id, "approve"),
    );
    await Effect.runPromise(client.armDecision(disconnectedTransaction));
    host.disconnect();
    expect(broker.pending().map((approval) => approval.id)).toContain(disconnected.approval.id);
    expect(broker.commitPreparedDecision(disconnectedTransaction)).toBe(false);

    const released = broker.begin({ ...approvalInput, sessionId: "released" });
    const directTransaction = randomUUID();
    expect(broker.prepareDecision(directTransaction, released.approval.id, "approve")).toBe(true);
    expect(broker.commitPreparedDecision(directTransaction)).toBe(false);
    expect(broker.armPreparedDecision(directTransaction)).toBe(true);
    expect(broker.commitPreparedDecision(directTransaction)).toBe(true);
    expect(await released.wait).toBe("approved");

    broker.cancel(disconnected.approval.id);
    broker.cancel(released.approval.id);
  });

  test("does not surface a fallible acknowledgement after one-way release", async () => {
    const host = new FakeProcessHost();
    const transport = new FakeProcessTransport();
    const broker = createConnectorApprovalBroker();
    registerConnectorApprovalProcessIpc(host, broker, emptyManagement);
    transport.forward = (message) => host.receive(message);
    host.responseSink = (message) => transport.respond(message);
    const client = createConnectorApprovalProcessClient(transport, 100);
    const approval = broker.begin(approvalInput);
    const transactionId = randomUUID();
    await Effect.runPromise(client.prepareDecision(transactionId, approval.approval.id, "approve"));
    await Effect.runPromise(client.armDecision(transactionId));
    transport.callbackError = true;
    await expect(Effect.runPromise(client.commitDecision(transactionId))).resolves.toBeUndefined();
    expect(await approval.wait).toBe("approved");
    broker.cancel(approval.approval.id);
  });

  test("dispatches exact connector management operations without execution-field catalog input", async () => {
    const host = new FakeProcessHost();
    const broker = createConnectorApprovalBroker();
    const saved: string[] = [];
    const removed: string[] = [];
    const management: ConnectorManagementPort = {
      ...emptyManagement,
      list: async () => ({ connectors: [] }),
      save: async (payload) => {
        decodeConnectorUpsertPayload(payload);
        saved.push(payload);
        return { connectors: [] };
      },
      remove: async (id) => {
        removed.push(id);
        return { connectors: [] };
      },
    };
    registerConnectorApprovalProcessIpc(host, broker, management);
    const client = linkedClient(host);
    expect(await Effect.runPromise(client.listConnectors())).toEqual({ connectors: [] });
    const payload = JSON.stringify({
      id: "github",
      catalogId: "github",
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "secret" },
      allowTools: [],
      permissionReviewed: false,
      enabled: false,
    });
    expect(await Effect.runPromise(client.saveConnector(payload))).toEqual({ connectors: [] });
    expect(await Effect.runPromise(client.removeConnector("github"))).toEqual({ connectors: [] });
    expect(saved).toEqual([payload]);
    expect(removed).toEqual(["github"]);
    expect(() =>
      decodeConnectorUpsertPayload(
        JSON.stringify({
          id: "github",
          catalogId: "github",
          command: "sh",
          args: ["-c", "evil"],
          cwd: "/tmp",
          env: { PATH: "/tmp" },
        }),
      ),
    ).toThrow("Invalid connector payload");
  });

  test("dispatches every exact settings operation and serializes sanitized responses", async () => {
    const host = new FakeProcessHost();
    const broker = createConnectorApprovalBroker();
    const calls: string[] = [];
    const management: ConnectorManagementPort = {
      ...emptyManagement,
      probe: async (id) => {
        calls.push(`probe:${id}`);
        return {
          ok: true,
          tool_count: 0,
          tool_names: [],
          tools: [],
          inventory_digest: "sha256:empty",
        };
      },
      listPlugins: async () => {
        calls.push("plugins:list");
        return { plugins: [] };
      },
      setPluginEnabled: async (id, enabled) => {
        calls.push(`plugins:${id}:${enabled}`);
        return { plugins: [] };
      },
      githubArtifactStatus: async () => {
        calls.push("github-artifact:status");
        return githubArtifactStatusResponse;
      },
      installGitHubArtifact: async () => {
        calls.push("github-artifact:install");
        return { ...githubArtifactStatusResponse, state: "installed" };
      },
      getGoogleAccount: async () => {
        calls.push("google:get");
        return googleAccountResponse;
      },
      saveGoogleClient: async (payload) => {
        calls.push(`google:save:${payload}`);
        return googleAccountResponse;
      },
      disconnectGoogleAccount: async (account) => {
        calls.push(`google:disconnect:${account}`);
        return googleAccountResponse;
      },
      beginGoogleAuthorization: async (account) => {
        calls.push(`google:begin:${account}`);
        return { authorizationUrl: "https://accounts.test/authorize" };
      },
      cancelGoogleAuthorization: async (account) => {
        calls.push(`google:cancel:${account}`);
        return { cancelled: true };
      },
    };
    registerConnectorApprovalProcessIpc(host, broker, management);
    const client = linkedClient(host);
    expect(JSON.parse(await Effect.runPromise(client.probeConnector("github")))).toEqual({
      ok: true,
      tool_count: 0,
      tool_names: [],
      tools: [],
      inventory_digest: "sha256:empty",
    });
    expect(JSON.parse(await Effect.runPromise(client.listPlugins()))).toEqual({ plugins: [] });
    expect(JSON.parse(await Effect.runPromise(client.setPluginEnabled("github", true)))).toEqual({
      plugins: [],
    });
    expect(JSON.parse(await Effect.runPromise(client.githubArtifactStatus()))).toEqual(
      githubArtifactStatusResponse,
    );
    expect(JSON.parse(await Effect.runPromise(client.installGitHubArtifact()))).toEqual({
      ...githubArtifactStatusResponse,
      state: "installed",
    });
    expect(JSON.parse(await Effect.runPromise(client.getGoogleAccount()))).toEqual(
      googleAccountResponse,
    );
    const googleClient = '{"clientId":"client","clientSecret":"secret"}';
    const savedGoogle = await Effect.runPromise(client.saveGoogleClient(googleClient));
    expect(savedGoogle).not.toContain("secret");
    expect(JSON.parse(savedGoogle)).toEqual(googleAccountResponse);
    expect(JSON.parse(await Effect.runPromise(client.disconnectGoogleAccount("gmail")))).toEqual(
      googleAccountResponse,
    );
    expect(
      JSON.parse(await Effect.runPromise(client.beginGoogleAuthorization("google-calendar"))),
    ).toEqual({ authorizationUrl: "https://accounts.test/authorize" });
    expect(
      JSON.parse(await Effect.runPromise(client.cancelGoogleAuthorization("google-calendar"))),
    ).toEqual({ cancelled: true });
    expect(calls).toEqual([
      "probe:github",
      "plugins:list",
      "plugins:github:true",
      "github-artifact:status",
      "github-artifact:install",
      "google:get",
      `google:save:${googleClient}`,
      "google:disconnect:gmail",
      "google:begin:google-calendar",
      "google:cancel:google-calendar",
    ]);
  });

  test("fails closed when settings responses are invalid or lost", async () => {
    const invalidHost = new FakeProcessHost();
    registerConnectorApprovalProcessIpc(invalidHost, createConnectorApprovalBroker(), {
      ...emptyManagement,
      probe: async () => ({ ok: true, tool_count: 0, tool_names: [], tools: [], secret: true }),
    });
    await expect(
      Effect.runPromise(linkedClient(invalidHost).probeConnector("github")),
    ).rejects.toThrow("Connector discovery failed");

    const invalidStatusHost = new FakeProcessHost();
    registerConnectorApprovalProcessIpc(invalidStatusHost, createConnectorApprovalBroker(), {
      ...emptyManagement,
      githubArtifactStatus: async () => ({ ...githubArtifactStatusResponse, secret: true }),
    });
    await expect(
      Effect.runPromise(linkedClient(invalidStatusHost).githubArtifactStatus()),
    ).rejects.toThrow("GitHub connector artifact status failed");

    const lostHost = new FakeProcessHost();
    let probes = 0;
    registerConnectorApprovalProcessIpc(lostHost, createConnectorApprovalBroker(), {
      ...emptyManagement,
      probe: async () => {
        probes += 1;
        return { ok: true, tool_count: 0, tool_names: [], tools: [] };
      },
    });
    lostHost.dropResponses = true;
    await expect(
      Effect.runPromise(linkedClient(lostHost, 5).probeConnector("github")),
    ).rejects.toThrow("timed out");
    expect(probes).toBe(1);
  });

  test("uses HTTP only outside embedded mode and never falls back after bridge loss", async () => {
    const originalWindow = Reflect.get(globalThis, "window");
    const originalFetch = globalThis.fetch;
    let fetches = 0;
    globalThis.fetch = async () => {
      fetches += 1;
      return Response.json(googleAccountResponse);
    };
    try {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
          localStudioDesktop: {
            getRuntime: async () => ({ mode: "embedded-standalone" }),
            googleAccount: {
              get: async () => {
                throw new Error("Private request timed out");
              },
            },
          },
        },
      });
      await expect(getManagedGoogleAccount()).rejects.toThrow("Private request timed out");
      expect(fetches).toBe(0);

      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
          localStudioDesktop: {
            getRuntime: async () => ({ mode: "dev-server" }),
            googleAccount: {
              get: async () => {
                throw new Error("Dev server bridge must not be used");
              },
            },
          },
        },
      });
      expect(await getManagedGoogleAccount()).toEqual(googleAccountResponse);
      expect(fetches).toBe(1);

      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {},
      });
      expect(await getManagedGoogleAccount()).toEqual(googleAccountResponse);
      expect(fetches).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalWindow === undefined) Reflect.deleteProperty(globalThis, "window");
      else {
        Object.defineProperty(globalThis, "window", {
          configurable: true,
          value: originalWindow,
        });
      }
    }
  });
});
