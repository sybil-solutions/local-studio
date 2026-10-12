"use client";

import { useCallback, useState } from "react";
import { Schema } from "effect";
import {
  GoogleAccountResponseSchema,
  type GoogleAccountView,
} from "@local-studio/agent-runtime/google-account-contract";
import {
  GOOGLE_WORKSPACE_BINDINGS,
  GOOGLE_WORKSPACE_PLUGIN_IDS,
  type GoogleWorkspacePluginId,
} from "@local-studio/agent-runtime/google-workspace-binding";
import { Alert, RefreshIconButton } from "@/ui";
import { ResourceLogo } from "@/ui/resource-logo";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import {
  DataRow,
  EndCell,
  HeadCell,
  IdentityCell,
  RowAction,
  StatusText,
  TableFrame,
  TableSection,
  TableSkeleton,
  TextCell,
  type StatusTone,
} from "@/features/recipes/recipes-content/catalog-table-shell";
import { GoogleAccountModal } from "./google-account-modal";
import { connectedGoogleAccounts, requestJson } from "./google-account-model";

/**
 * Accounts a session signs into, rather than servers it launches.
 *
 * The binding for each one lives in code (endpoint, scopes, read-only tools),
 * so this table only ever renders the accounts Local Studio ships with — there
 * is nothing on disk to scan and no catalogue to page through.
 */
const ACCOUNT_COLUMNS = ["Account", "Access", "State"] as const;
const ACCOUNT_MIN_WIDTH = "min-w-[34rem]";

type AccountState = { label: string; tone: StatusTone; action: string };

function accountState(
  account: GoogleAccountView | null,
  id: GoogleWorkspacePluginId,
): AccountState {
  if (!account?.configured) return { label: "Setup needed", tone: "warn", action: "Set up" };
  const connected = connectedGoogleAccounts(account, id).length;
  if (!connected) return { label: "Signed out", tone: "dim", action: "Sign in" };
  return {
    label: connected === 1 ? "1 signed in" : `${connected} signed in`,
    tone: "ok",
    action: "Manage",
  };
}

function accountSummary(account: GoogleAccountView | null, id: GoogleWorkspacePluginId): string {
  const emails = connectedGoogleAccounts(account, id).map((entry) => entry.email);
  return emails.length ? emails.join(", ") : "Google Workspace";
}

export function GoogleAccountsSection() {
  const [account, setAccount] = useState<GoogleAccountView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [openAccount, setOpenAccount] = useState<GoogleWorkspacePluginId | null>(null);

  const refresh = useCallback(() => {
    setRefreshing(true);
    void requestJson<{ account: GoogleAccountView }>(
      "/api/agent/accounts/google",
      Schema.decodeUnknownSync(GoogleAccountResponseSchema),
      { cache: "no-store" },
    )
      .then((result) => {
        setAccount(result.account);
        setError("");
      })
      .catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : "Google account failed");
      })
      .finally(() => {
        setLoaded(true);
        setRefreshing(false);
      });
  }, []);

  useMountSubscription(() => {
    refresh();
  }, [refresh]);

  return (
    <>
      {error ? (
        <div className="mb-4">
          <Alert variant="error">{error}</Alert>
        </div>
      ) : null}
      <TableSection
        title="Accounts"
        description="Google services a session can read from. Each one can hold several signed-in mailboxes."
        actions={
          <div className="flex items-center gap-2">
            <StatusText tone={error ? "warn" : loaded ? "ok" : "dim"}>
              {loaded ? `${GOOGLE_WORKSPACE_PLUGIN_IDS.length} services` : "loading"}
            </StatusText>
            <RefreshIconButton onClick={refresh} loading={refreshing} label="Refresh accounts" />
          </div>
        }
      >
        {!loaded ? (
          <TableSkeleton columns={ACCOUNT_COLUMNS} rows={2} minWidthClass={ACCOUNT_MIN_WIDTH} />
        ) : (
          <TableFrame minWidthClass={ACCOUNT_MIN_WIDTH}>
            <thead>
              <tr>
                {ACCOUNT_COLUMNS.map((column, index) => (
                  <HeadCell key={column} numeric={index === ACCOUNT_COLUMNS.length - 1}>
                    {column}
                  </HeadCell>
                ))}
              </tr>
            </thead>
            <tbody>
              {GOOGLE_WORKSPACE_PLUGIN_IDS.map((id) => {
                const binding = GOOGLE_WORKSPACE_BINDINGS[id];
                const state = accountState(account, id);
                return (
                  <DataRow
                    key={id}
                    onOpen={() => setOpenAccount(id)}
                    ariaLabel={`Open ${binding.name}`}
                  >
                    <IdentityCell
                      leading={<ResourceLogo identity={id} label={binding.name} company="Google" />}
                      label={binding.name}
                      description={accountSummary(account, id)}
                    />
                    <TextCell>{`${binding.observeTools.length} read-only tools`}</TextCell>
                    <EndCell>
                      <div className="flex items-center justify-end gap-2">
                        <StatusText tone={state.tone}>{state.label}</StatusText>
                        <RowAction
                          alwaysVisible
                          onClick={() => setOpenAccount(id)}
                          title={`${state.action} ${binding.name}`}
                        >
                          {state.action}
                        </RowAction>
                      </div>
                    </EndCell>
                  </DataRow>
                );
              })}
            </tbody>
          </TableFrame>
        )}
      </TableSection>
      {openAccount ? (
        <GoogleAccountModal
          accountId={openAccount}
          displayName={GOOGLE_WORKSPACE_BINDINGS[openAccount].name}
          onClose={() => setOpenAccount(null)}
          onChanged={refresh}
        />
      ) : null}
    </>
  );
}
