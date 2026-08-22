import { Schema } from "effect";
import type {
  GoogleAccountEntryView,
  GoogleAccountView,
} from "@local-studio/agent-runtime/google-account-contract";
import type { GoogleWorkspacePluginId } from "@local-studio/agent-runtime/google-workspace-binding";

export const GoogleCancellationResponseSchema = Schema.Struct({
  cancelled: Schema.Literal(true),
});

export async function openExternal(url: string): Promise<void> {
  const bridge = window.localStudioDesktop?.openExternal;
  if (bridge && (await bridge(url))) return;
  if (!window.open(url, "_blank", "noopener,noreferrer")) {
    throw new Error("Local Studio could not open the Google sign-in page");
  }
}

export function connectedGoogleAccounts(
  account: GoogleAccountView | null,
  service: GoogleWorkspacePluginId,
): GoogleAccountEntryView[] {
  return (account?.accounts ?? []).filter((entry) => entry.connections[service].connected);
}

/**
 * Identifies the exact set of live connections, so the sign-in wait ends both
 * when a mailbox is added and when an existing one is re-authorized.
 */
export function connectionSignature(
  account: GoogleAccountView | null,
  service: GoogleWorkspacePluginId,
): string {
  return connectedGoogleAccounts(account, service)
    .map((entry) => `${entry.key}@${entry.connections[service].connectedAt ?? ""}`)
    .join("|");
}

export function clientReplacementWarning(
  account: GoogleAccountView | null,
  editing: boolean,
  clientId: string,
): string | null {
  if (!editing || !account?.configured) return null;
  if (clientId.trim() === account.clientId) return null;
  const connected = account.accounts.length;
  if (!connected) return null;
  const plural = connected === 1 ? "account" : "accounts";
  return `Replacing this client revokes Google access for all ${connected} connected ${plural}, across Gmail and Calendar. Each one has to sign in again.`;
}
