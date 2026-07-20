"use client";

import { useCallback, useState, type ReactNode } from "react";
import { Effect, Fiber } from "effect";
import { type GoogleAccountView } from "@local-studio/agent-runtime/google-account-contract";
import type { GoogleWorkspacePluginId } from "@local-studio/agent-runtime/google-workspace-binding";
import { Alert, UiModal, UiModalHeader } from "@/ui";
import { KeyRound, X } from "@/ui/icon-registry";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import {
  beginManagedGoogleAuthorization,
  cancelManagedGoogleAuthorization,
  disconnectManagedGoogleAccount,
  getManagedGoogleAccount,
  openExternal,
  saveManagedGoogleClient,
  sharedClientWarning,
} from "./google-account-model";
import { GoogleAccountLoadState } from "./google-account-load-state";
import { ConnectedGoogleAccount } from "./google-account-connected";
import { GoogleAccountSetup } from "./google-account-setup";

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
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lifecycle] = useState(() => ({
    active: false,
    cancelAuthorizationRequest: async (): Promise<void> => undefined,
  }));

  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      const result = await getManagedGoogleAccount();
      setAccount(result.account);
      setError("");
      setClientId((current) => current || result.account.clientId || "");
      if (!result.account.configured) setEditing(true);
      const connected = result.account.connections[accountId].connected;
      if (connected) {
        lifecycle.active = false;
        setAwaiting(false);
        onChanged();
      }
      return connected;
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
    await cancelManagedGoogleAuthorization(accountId);
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
        const saved = await saveManagedGoogleClient(clientId, clientSecret);
        setAccount(saved.account);
        onChanged();
        setEditing(false);
        setClientSecret("");
      }
      lifecycle.active = true;
      const result = await beginManagedGoogleAuthorization(accountId);
      await openExternal(result.authorizationUrl);
      setAwaiting(true);
    } catch (connectError) {
      if (lifecycle.active) await cancelAuthorization().catch(() => undefined);
      setError(connectError instanceof Error ? connectError.message : "Google sign-in failed");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await disconnectManagedGoogleAccount(accountId);
      setAccount(result.account);
      setConfirmingDisconnect(false);
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
      onClose();
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "Cancellation failed");
    } finally {
      setBusy(false);
    }
  };

  const connection = account?.connections[accountId];
  const warning = sharedClientWarning(accountId, account, editing, clientId);
  const dismiss = () => {
    if (!busy && !awaiting) onClose();
  };
  let content: ReactNode;
  if (!account) {
    content = <GoogleAccountLoadState error={error} onRetry={() => void refresh()} />;
  } else if (connection?.connected && !editing) {
    content = (
      <ConnectedGoogleAccount
        email={connection.email}
        displayName={displayName}
        confirming={confirmingDisconnect}
        busy={busy}
        onConfirm={() => setConfirmingDisconnect(true)}
        onKeep={() => setConfirmingDisconnect(false)}
        onDisconnect={() => void disconnect()}
        onClose={onClose}
      />
    );
  } else {
    content = (
      <GoogleAccountSetup
        account={account}
        editing={editing}
        clientId={clientId}
        clientSecret={clientSecret}
        sharedClientWarning={warning}
        awaiting={awaiting}
        busy={busy}
        onClientId={setClientId}
        onClientSecret={setClientSecret}
        onEdit={() => setEditing(true)}
        onClose={onClose}
        onCancelSignIn={() => void cancelSignIn()}
        onConnect={() => void connect()}
      />
    );
  }
  return (
    <UiModal isOpen onClose={dismiss} maxWidth="max-w-lg">
      <UiModalHeader
        title={connection?.connected ? displayName : `Connect ${displayName}`}
        icon={
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-(--ui-info)/30 bg-(--ui-info)/10">
            <KeyRound className="h-4 w-4 text-(--ui-info)" />
          </span>
        }
        onClose={dismiss}
        showCloseButton={!awaiting}
        closeIcon={<X className="h-4 w-4" />}
      />
      <div className="space-y-5 px-6 py-5">
        <Alert variant="info">
          Google&apos;s first-party Workspace MCP is in developer preview. Add a Desktop OAuth
          client once; Local Studio encrypts it with the desktop keychain and exposes only declared
          read-only tools.
        </Alert>
        {content}
        {error && account ? <Alert variant="error">{error}</Alert> : null}
      </div>
    </UiModal>
  );
}
