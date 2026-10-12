import { Effect } from "effect";
import { protectManagedConnector, type ConnectorConfig } from "./connectors-service";
import { googleAuthorizationHeaders } from "./google-account";
import {
  googleWorkspaceAuthAccount,
  googleWorkspaceConnectorIdentity,
  type GoogleWorkspaceIdentity,
} from "./google-workspace-binding";

/**
 * The account a connector is allowed to authorize as is derived from its id,
 * not read from its `auth.account` field — the field only has to agree. A row
 * whose id names one mailbox cannot mint tokens for another.
 */
export function googleWorkspaceConnectorAuth(
  connector: ConnectorConfig,
): GoogleWorkspaceIdentity | null {
  const protectedConnector = protectManagedConnector(connector);
  const reference = protectedConnector.auth;
  const identity = googleWorkspaceConnectorIdentity(protectedConnector.id);
  if (!identity || reference?.type !== "oauth") return null;
  if (reference.provider !== "google-workspace") return null;
  return reference.account === googleWorkspaceAuthAccount(identity) ? identity : null;
}

export async function connectorAuthorizationHeaders(
  connector: ConnectorConfig,
  forceRefresh: boolean,
): Promise<Record<string, string>> {
  const identity = googleWorkspaceConnectorAuth(connector);
  if (identity) return Effect.runPromise(googleAuthorizationHeaders(identity, forceRefresh));
  throw new Error("Unsupported connector authorization provider");
}
