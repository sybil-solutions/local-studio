"use client";

import { useCallback, useState } from "react";
import { Effect, Fiber, Schema } from "effect";
import {
  GoogleAccountResponseSchema,
  GoogleAuthorizationResponseSchema,
  type GoogleAccountView,
} from "@local-studio/agent-runtime/google-account-contract";
import type { GoogleWorkspacePluginId } from "@local-studio/agent-runtime/google-workspace-binding";
import { Alert, Button, UiModal, UiModalBody, UiModalHeader } from "@/ui";
import { KeyRound, X } from "@/ui/icon-registry";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { jsonBody, requestAgentJson } from "./agent-json";
import {
  GoogleCancellationResponseSchema,
  clientReplacementWarning,
  connectedGoogleAccounts,
  connectionSignature,
  openExternal,
} from "./google-account-model";
import { GoogleAccountLoadState } from "./google-account-load-state";
import { ConnectedGoogleAccounts } from "./google-account-connected";
import { GoogleAccountSetup } from "./google-account-setup";

const ACCOUNT_URL = "/api/agent/accounts/google";
const AUTHORIZE_URL = "/api/agent/accounts/google/authorize";
const decodeAccount = Schema.decodeUnknownSync(GoogleAccountResponseSchema);

export function GoogleAccountModal({
  accountId,
  displayName,
  onClose,
  onChanged,
}: {
  accountId: GoogleWorkspacePluginId;
  displayName: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [account, setAccount] = useState<GoogleAccountView | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [editing, setEditing] = useState(false);
  const [awaiting, setAwaiting] = useState(false);
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lifecycle] = useState(() => ({
    active: false,
    // The signature of the connections that existed when sign-in started; the
    // wait ends as soon as it changes, which covers both a mailbox being added
    // and an existing one being re-authorized.
    baseline: "",
    cancelAuthorizationRequest: async (): Promise<void> => undefined,
  }));

  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      const result = await requestAgentJson<{ account: GoogleAccountView }>(
        ACCOUNT_URL,
        decodeAccount,
      );
      setAccount(result.account);
      setError("");
      setClientId((current) => current || result.account.clientId || "");
      if (!result.account.configured) setEditing(true);
      const settled =
        lifecycle.active && connectionSignature(result.account, accountId) !== lifecycle.baseline;
      if (settled) {
        lifecycle.active = false;
        setAwaiting(false);
        onChanged();
      }
      return settled;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Google account failed");
      return false;
    }
  }, [accountId, lifecycle, onChanged]);

  useMountSubscription(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const cancelAuthorizationRequest = useCallback(async (): Promise<void> => {
    await requestAgentJson(
      AUTHORIZE_URL,
      Schema.decodeUnknownSync(GoogleCancellationResponseSchema),
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ account: accountId }),
        keepalive: true,
      },
    );
  }, [accountId]);

  const cancelAuthorization = useCallback(async (): Promise<void> => {
    await cancelAuthorizationRequest();
    lifecycle.active = false;
    setAwaiting(false);
  }, [cancelAuthorizationRequest, lifecycle]);

  lifecycle.cancelAuthorizationRequest = cancelAuthorizationRequest;

  useMountSubscription(
    () => () => {
      if (lifecycle.active) void lifecycle.cancelAuthorizationRequest();
    },
    [],
  );

  useMountSubscription(() => {
    if (!awaiting) return;
    const fiber = Effect.runFork(
      Effect.gen(function* () {
        for (let attempt = 0; attempt < 90; attempt += 1) {
          yield* Effect.sleep(1_000);
          if (yield* Effect.promise(refresh)) return;
        }
        yield* Effect.promise(() => cancelAuthorization().catch(() => undefined));
        setAwaiting(false);
        setError("Google sign-in timed out. Start again when you are ready.");
      }),
    );
    return () => void Effect.runPromise(Fiber.interrupt(fiber));
  }, [awaiting, cancelAuthorization, refresh]);

  const connect = async () => {
    setBusy(true);
    setError("");
    try {
      if (!account?.configured || editing) {
        const saved = await requestAgentJson<{ account: GoogleAccountView }>(
          ACCOUNT_URL,
          decodeAccount,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ clientId, clientSecret }),
          },
        );
        setAccount(saved.account);
        onChanged();
        setEditing(false);
        setClientSecret("");
      }
      lifecycle.active = true;
      lifecycle.baseline = connectionSignature(account, accountId);
      const result = await requestAgentJson<{ authorizationUrl: string }>(
        AUTHORIZE_URL,
        Schema.decodeUnknownSync(GoogleAuthorizationResponseSchema),
        jsonBody({ account: accountId }),
      );
      await openExternal(result.authorizationUrl);
      setAwaiting(true);
    } catch (connectError) {
      if (lifecycle.active) await cancelAuthorization().catch(() => undefined);
      setError(connectError instanceof Error ? connectError.message : "Google sign-in failed");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (accountKey: string) => {
    setBusy(true);
    setError("");
    try {
      const result = await requestAgentJson<{ account: GoogleAccountView }>(
        ACCOUNT_URL,
        decodeAccount,
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ account: accountId, accountKey }),
        },
      );
      setAccount(result.account);
      setConfirmingKey(null);
      onChanged();
    } catch (disconnectError) {
      await refresh();
      setError(disconnectError instanceof Error ? disconnectError.message : "Disconnect failed");
    } finally {
      setBusy(false);
    }
  };

  const cancelSignIn = async () => {
    setBusy(true);
    setError("");
    try {
      await cancelAuthorization();
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "Cancellation failed");
    } finally {
      setBusy(false);
    }
  };

  const connected = connectedGoogleAccounts(account, accountId);
  const replacement = clientReplacementWarning(account, editing, clientId);
  const needsClient = !account?.configured || editing;
  const dismiss = () => {
    if (!busy && !awaiting) onClose();
  };
  return (
    <UiModal isOpen onClose={dismiss} maxWidth="max-w-lg">
      <UiModalHeader
        title={connected.length ? displayName : `Connect ${displayName}`}
        icon={
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-(--ui-info)/30 bg-(--ui-info)/10">
            <KeyRound className="h-4 w-4 text-(--ui-info)" />
          </span>
        }
        onClose={dismiss}
        showCloseButton={!awaiting}
        closeIcon={<X className="h-4 w-4" />}
      />
      <UiModalBody className="space-y-4 pb-5">
        <Alert variant="info">
          Tools are served in-process from Google&apos;s public REST APIs, using only the read-only
          scopes granted below.
        </Alert>
        {!account ? (
          <GoogleAccountLoadState error={error} onRetry={() => void refresh()} />
        ) : (
          <>
            <GoogleAccountSetup
              account={account}
              editing={editing}
              clientId={clientId}
              clientSecret={clientSecret}
              replacementWarning={replacement}
              onClientId={setClientId}
              onClientSecret={setClientSecret}
              onEdit={() => setEditing(true)}
            />
            <ConnectedGoogleAccounts
              service={accountId}
              displayName={displayName}
              accounts={connected}
              confirmingKey={confirmingKey}
              busy={busy}
              onConfirm={setConfirmingKey}
              onKeep={() => setConfirmingKey(null)}
              onDisconnect={(key) => void disconnect(key)}
            />
            {awaiting ? (
              <Alert variant="success">
                Finish consent in your browser. Local Studio is checking for the connection.
              </Alert>
            ) : null}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                variant="secondary"
                onClick={awaiting ? () => void cancelSignIn() : onClose}
                loading={awaiting && busy}
                disabled={busy && !awaiting}
              >
                {awaiting ? "Cancel sign-in" : "Close"}
              </Button>
              <Button
                onClick={() => void connect()}
                loading={busy && !awaiting}
                disabled={awaiting || (needsClient && !clientId.trim())}
              >
                {awaiting
                  ? "Waiting for Google"
                  : replacement
                    ? "Revoke & replace"
                    : connected.length
                      ? "Add another account"
                      : "Continue with Google"}
              </Button>
            </div>
          </>
        )}
        {error && account ? <Alert variant="error">{error}</Alert> : null}
      </UiModalBody>
    </UiModal>
  );
}
