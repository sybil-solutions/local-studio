import { randomUUID } from "node:crypto";
import type { ChildProcess } from "node:child_process";
import { Effect } from "effect";
import {
  decodeConnectorApprovalProcessRequest,
  decodeConnectorApprovalProcessResponse,
  decodeConnectorApprovalProcessResponseTag,
  type ConnectorApprovalProcessRequest,
  type ConnectorApprovalProcessResponse,
} from "./connector-approval-ipc-contract";

export class ConnectorApprovalIpcError extends Error {}

export type ConnectorApprovalProcessTransport = {
  connected(): boolean;
  send(message: ConnectorApprovalProcessRequest, callback: (error: Error | null) => void): void;
  listen(onMessage: (message: unknown) => void, onClose: () => void): () => void;
};

type PendingRequest = {
  operation: ConnectorApprovalProcessResponse["operation"];
  fail(error: ConnectorApprovalIpcError): void;
  succeed(value: unknown): void;
};

export type ConnectorApprovalProcessClient = {
  list(): Effect.Effect<unknown, ConnectorApprovalIpcError>;
  prepareDecision(
    transactionId: string,
    requestId: string,
    decision: "approve" | "deny",
  ): Effect.Effect<void, ConnectorApprovalIpcError>;
  armDecision(transactionId: string): Effect.Effect<void, ConnectorApprovalIpcError>;
  commitDecision(transactionId: string): Effect.Effect<void, ConnectorApprovalIpcError>;
  cancelDecision(transactionId: string): Effect.Effect<void, ConnectorApprovalIpcError>;
  listConnectors(): Effect.Effect<unknown, ConnectorApprovalIpcError>;
  saveConnector(payload: string): Effect.Effect<unknown, ConnectorApprovalIpcError>;
  removeConnector(id: string): Effect.Effect<unknown, ConnectorApprovalIpcError>;
  probeConnector(id: string): Effect.Effect<string, ConnectorApprovalIpcError>;
  listPlugins(): Effect.Effect<string, ConnectorApprovalIpcError>;
  setPluginEnabled(id: string, enabled: boolean): Effect.Effect<string, ConnectorApprovalIpcError>;
  githubArtifactStatus(): Effect.Effect<string, ConnectorApprovalIpcError>;
  installGitHubArtifact(): Effect.Effect<string, ConnectorApprovalIpcError>;
  getGoogleAccount(): Effect.Effect<string, ConnectorApprovalIpcError>;
  saveGoogleClient(payload: string): Effect.Effect<string, ConnectorApprovalIpcError>;
  disconnectGoogleAccount(
    account: "gmail" | "google-calendar",
  ): Effect.Effect<string, ConnectorApprovalIpcError>;
  beginGoogleAuthorization(
    account: "gmail" | "google-calendar",
  ): Effect.Effect<string, ConnectorApprovalIpcError>;
  cancelGoogleAuthorization(
    account: "gmail" | "google-calendar",
  ): Effect.Effect<string, ConnectorApprovalIpcError>;
  close(): void;
};

const REQUEST_TIMEOUT_MS = 5_000;
const INSTALL_GITHUB_ARTIFACT_TIMEOUT_MS = 75_000;

export function childProcessConnectorApprovalTransport(
  child: ChildProcess,
): ConnectorApprovalProcessTransport {
  return {
    connected: () => child.connected,
    send: (message, callback) => {
      if (!child.send) {
        callback(new Error("Embedded frontend IPC is unavailable"));
        return;
      }
      child.send(message, undefined, undefined, callback);
    },
    listen: (onMessage, onClose) => {
      child.on("message", onMessage);
      child.on("disconnect", onClose);
      child.on("exit", onClose);
      return () => {
        child.off("message", onMessage);
        child.off("disconnect", onClose);
        child.off("exit", onClose);
      };
    },
  };
}

export function createConnectorApprovalProcessClient(
  transport: ConnectorApprovalProcessTransport,
  timeoutMs = REQUEST_TIMEOUT_MS,
): ConnectorApprovalProcessClient {
  const pending = new Map<string, PendingRequest>();
  let closed = false;

  const failAll = (message: string): void => {
    const error = new ConnectorApprovalIpcError(message);
    const requests = [...pending.values()];
    pending.clear();
    requests.forEach((request) => request.fail(error));
  };

  const onMessage = (message: unknown): void => {
    if (decodeConnectorApprovalProcessResponseTag(message)._tag !== "Some") return;
    let response: ConnectorApprovalProcessResponse;
    try {
      response = decodeConnectorApprovalProcessResponse(message);
    } catch {
      closed = true;
      unsubscribe();
      failAll("Embedded frontend returned an invalid private response");
      return;
    }
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    if (request.operation !== response.operation) {
      request.fail(new ConnectorApprovalIpcError("Embedded frontend private response mismatched"));
      return;
    }
    if (!response.ok) {
      request.fail(new ConnectorApprovalIpcError(response.error));
      return;
    }
    request.succeed(response.result);
  };

  const onClose = (): void => {
    if (closed) return;
    closed = true;
    unsubscribe();
    failAll("Embedded frontend private transport disconnected");
  };

  const unsubscribe = transport.listen(onMessage, onClose);

  const request = (
    message: ConnectorApprovalProcessRequest,
    operation: ConnectorApprovalProcessResponse["operation"],
    requestTimeoutMs = timeoutMs,
  ): Effect.Effect<unknown, ConnectorApprovalIpcError> =>
    Effect.callback<unknown, ConnectorApprovalIpcError>((resume) => {
      if (closed || !transport.connected()) {
        resume(Effect.fail(new ConnectorApprovalIpcError("Embedded frontend is unavailable")));
        return;
      }
      const decoded = decodeConnectorApprovalProcessRequest(message);
      pending.set(decoded.id, {
        operation,
        fail: (error) => resume(Effect.fail(error)),
        succeed: (value) => resume(Effect.succeed(value)),
      });
      try {
        transport.send(decoded, (error) => {
          if (!error) return;
          const active = pending.get(decoded.id);
          if (!active) return;
          pending.delete(decoded.id);
          active.fail(new ConnectorApprovalIpcError("Embedded frontend private request failed"));
        });
      } catch {
        const active = pending.get(decoded.id);
        pending.delete(decoded.id);
        active?.fail(new ConnectorApprovalIpcError("Embedded frontend private request failed"));
      }
      return Effect.sync(() => {
        pending.delete(decoded.id);
      });
    }).pipe(
      Effect.timeoutOrElse({
        duration: requestTimeoutMs,
        orElse: () => Effect.fail(new ConnectorApprovalIpcError("Private request timed out")),
      }),
    );

  const sendOneWay = (
    message: ConnectorApprovalProcessRequest,
  ): Effect.Effect<void, ConnectorApprovalIpcError> =>
    Effect.try({
      try: () => {
        if (closed || !transport.connected()) {
          throw new ConnectorApprovalIpcError("Embedded frontend is unavailable");
        }
        transport.send(decodeConnectorApprovalProcessRequest(message), () => undefined);
      },
      catch: () => new ConnectorApprovalIpcError("Embedded frontend private request failed"),
    });

  const serializedRequest = (
    message: ConnectorApprovalProcessRequest,
    operation: ConnectorApprovalProcessResponse["operation"],
    requestTimeoutMs = timeoutMs,
  ): Effect.Effect<string, ConnectorApprovalIpcError> =>
    request(message, operation, requestTimeoutMs).pipe(
      Effect.flatMap((result) =>
        typeof result === "string"
          ? Effect.succeed(result)
          : Effect.fail(new ConnectorApprovalIpcError("Embedded frontend response was invalid")),
      ),
    );

  const messageId = (): string => randomUUID();

  return {
    list: () =>
      request(
        {
          channel: "local-studio:desktop-private:request",
          id: messageId(),
          operation: "list-approvals",
        },
        "list-approvals",
      ),
    prepareDecision: (transactionId, requestId, decision) =>
      request(
        {
          channel: "local-studio:desktop-private:request",
          id: messageId(),
          operation: "prepare-approval",
          transaction_id: transactionId,
          input: { request_id: requestId, decision },
        },
        "prepare-approval",
      ).pipe(Effect.asVoid),
    armDecision: (transactionId) =>
      request(
        {
          channel: "local-studio:desktop-private:request",
          id: messageId(),
          operation: "arm-approval",
          transaction_id: transactionId,
        },
        "arm-approval",
      ).pipe(Effect.asVoid),
    commitDecision: (transactionId) =>
      sendOneWay({
        channel: "local-studio:desktop-private:request",
        id: messageId(),
        operation: "commit-approval",
        transaction_id: transactionId,
      }),
    cancelDecision: (transactionId) =>
      sendOneWay({
        channel: "local-studio:desktop-private:request",
        id: messageId(),
        operation: "cancel-approval",
        transaction_id: transactionId,
      }),
    listConnectors: () =>
      request(
        {
          channel: "local-studio:desktop-private:request",
          id: messageId(),
          operation: "list-connectors",
        },
        "list-connectors",
      ),
    saveConnector: (payload) =>
      request(
        {
          channel: "local-studio:desktop-private:request",
          id: messageId(),
          operation: "save-connector",
          payload,
        },
        "save-connector",
      ),
    removeConnector: (id) =>
      request(
        {
          channel: "local-studio:desktop-private:request",
          id: messageId(),
          operation: "remove-connector",
          connector_id: id,
        },
        "remove-connector",
      ),
    probeConnector: (id) =>
      serializedRequest(
        {
          channel: "local-studio:desktop-private:request",
          id: messageId(),
          operation: "probe-connector",
          connector_id: id,
        },
        "probe-connector",
      ),
    listPlugins: () =>
      serializedRequest(
        {
          channel: "local-studio:desktop-private:request",
          id: messageId(),
          operation: "list-plugins",
        },
        "list-plugins",
      ),
    setPluginEnabled: (id, enabled) =>
      serializedRequest(
        {
          channel: "local-studio:desktop-private:request",
          id: messageId(),
          operation: "set-plugin-enabled",
          plugin_id: id,
          enabled,
        },
        "set-plugin-enabled",
      ),
    githubArtifactStatus: () =>
      serializedRequest(
        {
          channel: "local-studio:desktop-private:request",
          id: messageId(),
          operation: "github-artifact-status",
        },
        "github-artifact-status",
      ),
    installGitHubArtifact: () =>
      serializedRequest(
        {
          channel: "local-studio:desktop-private:request",
          id: messageId(),
          operation: "install-github-artifact",
        },
        "install-github-artifact",
        INSTALL_GITHUB_ARTIFACT_TIMEOUT_MS,
      ),
    getGoogleAccount: () =>
      serializedRequest(
        {
          channel: "local-studio:desktop-private:request",
          id: messageId(),
          operation: "get-google-account",
        },
        "get-google-account",
      ),
    saveGoogleClient: (payload) =>
      serializedRequest(
        {
          channel: "local-studio:desktop-private:request",
          id: messageId(),
          operation: "save-google-client",
          payload,
        },
        "save-google-client",
      ),
    disconnectGoogleAccount: (account) =>
      serializedRequest(
        {
          channel: "local-studio:desktop-private:request",
          id: messageId(),
          operation: "disconnect-google-account",
          account,
        },
        "disconnect-google-account",
      ),
    beginGoogleAuthorization: (account) =>
      serializedRequest(
        {
          channel: "local-studio:desktop-private:request",
          id: messageId(),
          operation: "begin-google-authorization",
          account,
        },
        "begin-google-authorization",
      ),
    cancelGoogleAuthorization: (account) =>
      serializedRequest(
        {
          channel: "local-studio:desktop-private:request",
          id: messageId(),
          operation: "cancel-google-authorization",
          account,
        },
        "cancel-google-authorization",
      ),
    close: onClose,
  };
}
