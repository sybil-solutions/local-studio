import { Schema } from "effect";
import {
  GoogleAccountResponseSchema,
  GoogleAuthorizationResponseSchema,
  GoogleCancellationResponseSchema,
  type GoogleAccountResponse,
  type GoogleAccountView,
  type GoogleAuthorizationResponse,
  type GoogleCancellationResponse,
} from "@local-studio/agent-runtime/google-account-contract";
import type { GoogleWorkspacePluginId } from "@local-studio/agent-runtime/google-workspace-binding";
import { decodeDesktopBridgeJson, embeddedDesktopBridge } from "@/lib/embedded-desktop-bridge";

const exact = { onExcessProperty: "error" } as const;
const decodeGoogleAccount = Schema.decodeUnknownSync(GoogleAccountResponseSchema, exact);
const decodeGoogleAuthorization = Schema.decodeUnknownSync(
  GoogleAuthorizationResponseSchema,
  exact,
);
const decodeGoogleCancellation = Schema.decodeUnknownSync(GoogleCancellationResponseSchema, exact);

function responseError(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const error = Reflect.get(body, "error");
  return typeof error === "string" ? error : fallback;
}

export async function requestJson<T>(
  url: string,
  decode: (input: unknown) => T,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, init);
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(responseError(body, `Request failed (${response.status})`));
  return decode(body);
}

export async function getManagedGoogleAccount(): Promise<GoogleAccountResponse> {
  const bridge = await embeddedDesktopBridge();
  return bridge
    ? decodeDesktopBridgeJson(await bridge.googleAccount.get(), decodeGoogleAccount)
    : requestJson("/api/agent/accounts/google", decodeGoogleAccount, { cache: "no-store" });
}

export async function saveManagedGoogleClient(
  clientId: string,
  clientSecret: string,
): Promise<GoogleAccountResponse> {
  const payload = JSON.stringify({ clientId, clientSecret });
  const bridge = await embeddedDesktopBridge();
  return bridge
    ? decodeDesktopBridgeJson(await bridge.googleAccount.saveClient(payload), decodeGoogleAccount)
    : requestJson("/api/agent/accounts/google", decodeGoogleAccount, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: payload,
      });
}

export async function disconnectManagedGoogleAccount(
  account: GoogleWorkspacePluginId,
): Promise<GoogleAccountResponse> {
  const bridge = await embeddedDesktopBridge();
  return bridge
    ? decodeDesktopBridgeJson(await bridge.googleAccount.disconnect(account), decodeGoogleAccount)
    : requestJson("/api/agent/accounts/google", decodeGoogleAccount, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ account }),
      });
}

export async function beginManagedGoogleAuthorization(
  account: GoogleWorkspacePluginId,
): Promise<GoogleAuthorizationResponse> {
  const bridge = await embeddedDesktopBridge();
  return bridge
    ? decodeDesktopBridgeJson(
        await bridge.googleAccount.beginAuthorization(account),
        decodeGoogleAuthorization,
      )
    : requestJson("/api/agent/accounts/google/authorize", decodeGoogleAuthorization, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ account }),
      });
}

export async function cancelManagedGoogleAuthorization(
  account: GoogleWorkspacePluginId,
): Promise<GoogleCancellationResponse> {
  const bridge = await embeddedDesktopBridge();
  return bridge
    ? decodeDesktopBridgeJson(
        await bridge.googleAccount.cancelAuthorization(account),
        decodeGoogleCancellation,
      )
    : requestJson("/api/agent/accounts/google/authorize", decodeGoogleCancellation, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ account }),
        keepalive: true,
      });
}

export async function openExternal(url: string): Promise<void> {
  const bridge = window.localStudioDesktop?.openExternal;
  if (bridge && (await bridge(url))) return;
  if (!window.open(url, "_blank", "noopener,noreferrer")) {
    throw new Error("Local Studio could not open the Google sign-in page");
  }
}

export function sharedClientWarning(
  accountId: GoogleWorkspacePluginId,
  account: GoogleAccountView | null,
  editing: boolean,
  clientId: string,
): string | null {
  const otherAccountId = accountId === "gmail" ? "google-calendar" : "gmail";
  if (!editing || !account?.connections[otherAccountId].connected) return null;
  if (clientId.trim() === account.clientId) return null;
  const otherDisplayName = accountId === "gmail" ? "Google Calendar" : "Gmail";
  return `Replacing this client revokes the current Cloud project's Google access and disconnects ${otherDisplayName} before starting again.`;
}
