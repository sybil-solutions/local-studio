import { Effect, Schema } from "effect";
import { connectorApprovalBroker } from "@local-studio/agent-runtime/connector-approval";
import {
  ConnectorApprovalsResponseSchema,
  ConnectorTestResponseSchema,
  ConnectorsResponseSchema,
  GitHubConnectorArtifactStatusSchema,
} from "@local-studio/agent-runtime/connector-contract";
import {
  GoogleAccountInputSchema,
  GoogleAccountResponseSchema,
  GoogleAuthorizationResponseSchema,
  GoogleCancellationResponseSchema,
  GoogleClientInputSchema,
} from "@local-studio/agent-runtime/google-account-contract";
import { PluginRuntimeResponseSchema } from "@local-studio/agent-runtime/plugin-runtime-contract";
import {
  decodeConnectorUpsertPayload,
  listConnectors,
  removeConnector,
  toConnectorView,
} from "@local-studio/agent-runtime/connectors-service";
import { closePooledConnection } from "@local-studio/agent-runtime/connector-pool";
import { getGlobalSingleton } from "@local-studio/agent-runtime/instances";
import {
  beginManagedGoogleAuthorization,
  cancelManagedGoogleAuthorization,
  disconnectManagedGoogleAccount,
  getManagedGoogleAccount,
  getManagedGitHubConnectorArtifactStatus,
  installManagedGitHubConnectorArtifact,
  listManagedPlugins,
  probeManagedConnector,
  saveManagedGoogleClient,
  saveManagedConnector,
  setManagedPluginEnabled,
  SettingsManagementError,
} from "@local-studio/agent-runtime/settings-management";
import {
  decodeConnectorApprovalProcessRequest,
  decodeConnectorApprovalProcessRequestTag,
  decodeConnectorApprovalProcessResponse,
  type ConnectorApprovalProcessRequest,
  type ConnectorApprovalProcessResponse,
} from "../desktop/logic/connector-approval-ipc-contract";

type ConnectorApprovalBrokerPort = {
  pending(): unknown;
  prepareDecision(transactionId: string, requestId: string, decision: "approve" | "deny"): boolean;
  armPreparedDecision(transactionId: string): boolean;
  commitPreparedDecision(transactionId: string): boolean;
  cancelPreparedDecision(transactionId: string): boolean;
};

export type ConnectorManagementPort = {
  list(): Promise<unknown>;
  save(payload: string): Promise<unknown>;
  remove(id: string): Promise<unknown>;
  probe(id: string): Promise<unknown>;
  listPlugins(): Promise<unknown>;
  setPluginEnabled(id: string, enabled: boolean): Promise<unknown>;
  githubArtifactStatus(): Promise<unknown>;
  installGitHubArtifact(): Promise<unknown>;
  getGoogleAccount(): Promise<unknown>;
  saveGoogleClient(payload: string): Promise<unknown>;
  disconnectGoogleAccount(account: "gmail" | "google-calendar"): Promise<unknown>;
  beginGoogleAuthorization(account: "gmail" | "google-calendar"): Promise<unknown>;
  cancelGoogleAuthorization(account: "gmail" | "google-calendar"): Promise<unknown>;
};

export type ConnectorApprovalProcessHost = {
  identity: object;
  connected(): boolean;
  listen(listener: (message: unknown) => void): void;
  listenClose(listener: () => void): void;
  send(message: ConnectorApprovalProcessResponse): void;
};

type ListenerState = {
  ids: Set<string>;
  order: string[];
  transactions: Set<string>;
};

const MAX_CORRELATION_IDS = 512;
const MAX_TRANSACTIONS = 128;
const exact = { onExcessProperty: "error" } as const;
const registrations = getGlobalSingleton(
  "connectorApprovalProcessIpcRegistrations",
  () => new WeakMap<object, ListenerState>(),
);
const decodeApprovals = Schema.decodeUnknownSync(ConnectorApprovalsResponseSchema, exact);
const decodeConnectors = Schema.decodeUnknownSync(ConnectorsResponseSchema, exact);
const decodeConnectorTest = Schema.decodeUnknownSync(ConnectorTestResponseSchema, exact);
const decodePlugins = Schema.decodeUnknownSync(PluginRuntimeResponseSchema, exact);
const decodeGitHubArtifactStatus = Schema.decodeUnknownSync(
  GitHubConnectorArtifactStatusSchema,
  exact,
);
const decodeGoogleAccount = Schema.decodeUnknownSync(GoogleAccountResponseSchema, exact);
const decodeGoogleAuthorization = Schema.decodeUnknownSync(
  GoogleAuthorizationResponseSchema,
  exact,
);
const decodeGoogleCancellation = Schema.decodeUnknownSync(GoogleCancellationResponseSchema, exact);
const decodeGoogleClientInput = Schema.decodeUnknownSync(GoogleClientInputSchema, exact);
const decodeGoogleAccountInput = Schema.decodeUnknownSync(GoogleAccountInputSchema, exact);
const managementFailureMessages: Partial<
  Record<ConnectorApprovalProcessRequest["operation"], string>
> = {
  "probe-connector": "Connector discovery failed",
  "list-plugins": "Plugin discovery failed",
  "set-plugin-enabled": "Plugin activation failed",
  "github-artifact-status": "GitHub connector artifact status failed",
  "install-github-artifact": "GitHub connector artifact installation failed",
  "get-google-account": "Google account failed",
  "save-google-client": "Google account failed",
  "disconnect-google-account": "Google account failed",
  "begin-google-authorization": "Google sign-in failed",
  "cancel-google-authorization": "Google sign-in cancellation failed",
};

function decodedJson(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    throw new Error("Invalid private settings payload");
  }
}

const connectorManagement: ConnectorManagementPort = {
  list: async () => decodeConnectors({ connectors: (await listConnectors()).map(toConnectorView) }),
  save: async (payload) => {
    const input = decodeConnectorUpsertPayload(payload);
    const connectors = await Effect.runPromise(saveManagedConnector(input));
    return decodeConnectors({ connectors: connectors.map(toConnectorView) });
  },
  remove: async (id) => {
    const connectors = await removeConnector(id);
    closePooledConnection(id);
    return decodeConnectors({ connectors: connectors.map(toConnectorView) });
  },
  probe: (id) => Effect.runPromise(probeManagedConnector(id)),
  listPlugins: () => Effect.runPromise(listManagedPlugins()),
  setPluginEnabled: (id, enabled) => Effect.runPromise(setManagedPluginEnabled({ id, enabled })),
  githubArtifactStatus: () => Effect.runPromise(getManagedGitHubConnectorArtifactStatus()),
  installGitHubArtifact: () => Effect.runPromise(installManagedGitHubConnectorArtifact()),
  getGoogleAccount: () => Effect.runPromise(getManagedGoogleAccount()),
  saveGoogleClient: (payload) =>
    Effect.runPromise(saveManagedGoogleClient(decodeGoogleClientInput(decodedJson(payload)))),
  disconnectGoogleAccount: (account) =>
    Effect.runPromise(disconnectManagedGoogleAccount(decodeGoogleAccountInput({ account }))),
  beginGoogleAuthorization: (account) =>
    Effect.runPromise(beginManagedGoogleAuthorization(decodeGoogleAccountInput({ account }))),
  cancelGoogleAuthorization: (account) =>
    Effect.runPromise(cancelManagedGoogleAuthorization(decodeGoogleAccountInput({ account }))),
};

function remember(state: ListenerState, id: string): boolean {
  if (state.ids.has(id)) return false;
  state.ids.add(id);
  state.order.push(id);
  const expired = state.order.length > MAX_CORRELATION_IDS ? state.order.shift() : undefined;
  if (expired) state.ids.delete(expired);
  return true;
}

function trackTransaction(
  state: ListenerState,
  broker: ConnectorApprovalBrokerPort,
  transactionId: string,
): void {
  if (state.transactions.has(transactionId)) return;
  if (state.transactions.size >= MAX_TRANSACTIONS) {
    const oldest = state.transactions.values().next().value;
    if (oldest) {
      broker.cancelPreparedDecision(oldest);
      state.transactions.delete(oldest);
    }
  }
  state.transactions.add(transactionId);
}

function response(
  request: ConnectorApprovalProcessRequest,
  result: unknown,
): ConnectorApprovalProcessResponse {
  if (request.operation === "commit-approval" || request.operation === "cancel-approval") {
    throw new Error("One-way connector operation cannot return a response");
  }
  return decodeConnectorApprovalProcessResponse({
    channel: "local-studio:desktop-private:response",
    id: request.id,
    operation: request.operation,
    ok: true,
    result,
  });
}

function failure(
  request: ConnectorApprovalProcessRequest,
  error: unknown,
): ConnectorApprovalProcessResponse {
  if (request.operation === "commit-approval" || request.operation === "cancel-approval") {
    throw new Error("One-way connector operation cannot return a response");
  }
  const fallback = managementFailureMessages[request.operation];
  return decodeConnectorApprovalProcessResponse({
    channel: "local-studio:desktop-private:response",
    id: request.id,
    operation: request.operation,
    ok: false,
    error:
      fallback && !(error instanceof SettingsManagementError)
        ? fallback
        : error instanceof Error
          ? error.message
          : (fallback ?? "Private connector operation failed"),
  });
}

function serializedResult(request: ConnectorApprovalProcessRequest, result: unknown): unknown {
  const serialize = (value: unknown): string => {
    const payload = JSON.stringify(value);
    if (!payload) throw new Error("Private settings result could not be serialized");
    return payload;
  };
  if (request.operation === "probe-connector") return serialize(decodeConnectorTest(result));
  if (request.operation === "list-plugins" || request.operation === "set-plugin-enabled") {
    return serialize(decodePlugins(result));
  }
  if (
    request.operation === "github-artifact-status" ||
    request.operation === "install-github-artifact"
  ) {
    return serialize(decodeGitHubArtifactStatus(result));
  }
  if (
    request.operation === "get-google-account" ||
    request.operation === "save-google-client" ||
    request.operation === "disconnect-google-account"
  ) {
    return serialize(decodeGoogleAccount(result));
  }
  if (request.operation === "begin-google-authorization") {
    return serialize(decodeGoogleAuthorization(result));
  }
  if (request.operation === "cancel-google-authorization") {
    return serialize(decodeGoogleCancellation(result));
  }
  return result;
}

function managementRequest(
  request: ConnectorApprovalProcessRequest,
  management: ConnectorManagementPort,
): Promise<unknown> {
  if (request.operation === "list-connectors") return management.list();
  if (request.operation === "save-connector") return management.save(request.payload);
  if (request.operation === "remove-connector") return management.remove(request.connector_id);
  if (request.operation === "probe-connector") return management.probe(request.connector_id);
  if (request.operation === "list-plugins") return management.listPlugins();
  if (request.operation === "set-plugin-enabled") {
    return management.setPluginEnabled(request.plugin_id, request.enabled);
  }
  if (request.operation === "github-artifact-status") return management.githubArtifactStatus();
  if (request.operation === "install-github-artifact") return management.installGitHubArtifact();
  if (request.operation === "get-google-account") return management.getGoogleAccount();
  if (request.operation === "save-google-client") {
    return management.saveGoogleClient(request.payload);
  }
  if (request.operation === "disconnect-google-account") {
    return management.disconnectGoogleAccount(request.account);
  }
  if (request.operation === "begin-google-authorization") {
    return management.beginGoogleAuthorization(request.account);
  }
  if (request.operation === "cancel-google-authorization") {
    return management.cancelGoogleAuthorization(request.account);
  }
  return Promise.reject(new Error("Unsupported private settings operation"));
}

function responseEffect(
  request: ConnectorApprovalProcessRequest,
  broker: ConnectorApprovalBrokerPort,
  management: ConnectorManagementPort,
  state: ListenerState,
): Effect.Effect<ConnectorApprovalProcessResponse | null> {
  if (request.operation === "commit-approval") {
    return Effect.sync(() => {
      broker.commitPreparedDecision(request.transaction_id);
      state.transactions.delete(request.transaction_id);
      return null;
    });
  }
  if (request.operation === "cancel-approval") {
    return Effect.sync(() => {
      broker.cancelPreparedDecision(request.transaction_id);
      state.transactions.delete(request.transaction_id);
      return null;
    });
  }
  if (request.operation === "list-approvals") {
    return Effect.sync(() => {
      try {
        return response(request, decodeApprovals({ approvals: broker.pending() }));
      } catch (error) {
        return failure(request, error);
      }
    });
  }
  if (request.operation === "prepare-approval") {
    return Effect.sync(() => {
      try {
        if (
          !broker.prepareDecision(
            request.transaction_id,
            request.input.request_id,
            request.input.decision,
          )
        ) {
          throw new Error("Connector approval could not be prepared");
        }
        trackTransaction(state, broker, request.transaction_id);
        return response(request, { prepared: true });
      } catch (error) {
        return failure(request, error);
      }
    });
  }
  if (request.operation === "arm-approval") {
    return Effect.sync(() => {
      try {
        if (!broker.armPreparedDecision(request.transaction_id)) {
          throw new Error("Connector approval could not be armed");
        }
        return response(request, { armed: true });
      } catch (error) {
        return failure(request, error);
      }
    });
  }
  return Effect.tryPromise({
    try: () => managementRequest(request, management),
    catch: (error) => error,
  }).pipe(
    Effect.flatMap((result) =>
      Effect.try({
        try: () => response(request, serializedResult(request, result)),
        catch: (error) => error,
      }),
    ),
    Effect.catch((error) => Effect.succeed(failure(request, error))),
  );
}

function nodeProcessHost(): ConnectorApprovalProcessHost {
  return {
    identity: process,
    connected: () => Boolean(process.connected && process.send),
    listen: (listener) => {
      process.on("message", listener);
    },
    listenClose: (listener) => {
      process.on("disconnect", listener);
    },
    send: (message) => {
      process.send?.(message);
    },
  };
}

export function registerConnectorApprovalProcessIpc(
  host: ConnectorApprovalProcessHost = nodeProcessHost(),
  broker: ConnectorApprovalBrokerPort = connectorApprovalBroker,
  management: ConnectorManagementPort = connectorManagement,
): void {
  if (registrations.has(host.identity)) return;
  const state: ListenerState = { ids: new Set(), order: [], transactions: new Set() };
  registrations.set(host.identity, state);
  host.listenClose(() => {
    state.transactions.forEach((id) => broker.cancelPreparedDecision(id));
    state.transactions.clear();
  });
  host.listen((message) => {
    if (decodeConnectorApprovalProcessRequestTag(message)._tag !== "Some") return;
    let request: ConnectorApprovalProcessRequest;
    try {
      request = decodeConnectorApprovalProcessRequest(message);
    } catch {
      return;
    }
    if (!host.connected() || !remember(state, request.id)) return;
    Effect.runFork(
      responseEffect(request, broker, management, state).pipe(
        Effect.tap((result) =>
          Effect.sync(() => {
            if (result && host.connected()) host.send(result);
          }),
        ),
        Effect.catch(() => Effect.void),
      ),
    );
  });
}
