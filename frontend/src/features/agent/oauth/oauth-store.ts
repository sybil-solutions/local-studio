// Provider-agnostic, durable OAuth credential store for MCP servers that read
// OAuth material (client id/secret, refresh token, access token) from their
// process env.
//
// For each connected provider we persist the user's OAuth client id/secret plus
// the long-lived refresh token (when the provider issues one) under the data
// dir, then mint a fresh access token on demand. The OAuth env is injected into
// the MCP server's `.mcp.json` right before a turn starts (see managed-tokens).
//
// Credentials live at `<dataDir>/oauth/<providerId>.json`; the Google file keeps
// its original `google.json` name and field shape so existing connections carry
// over unchanged.

import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveDataDir } from "@/lib/data-dir";
import { OAUTH_PROVIDERS, getOAuthProvider, type OAuthProvider } from "./oauth-providers";

// Refresh a little before the real expiry so a turn never starts with a token
// that dies mid-flight.
const REFRESH_SKEW_MS = 120_000;

export type OAuthCredentials = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accessToken: string;
  accessTokenExpiresAt: number;
  email: string;
  scopes: string[];
  updatedAt: string;
};

export type OAuthStatus = {
  providerId: string;
  displayName: string;
  hasCredentials: boolean;
  configuredByApp: boolean;
  connected: boolean;
  email: string;
  scopes: string[];
  accessTokenExpiresAt: number;
};

export type FreshOAuthCredentials = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accessToken: string;
  expiresAt: number;
};

type EffectiveClient = {
  clientId: string;
  clientSecret: string;
  configuredByApp: boolean;
};

function requireProvider(providerId: string): OAuthProvider {
  const provider = getOAuthProvider(providerId);
  if (!provider) throw new Error(`Unknown OAuth provider: ${providerId}`);
  return provider;
}

function credentialsPath(providerId: string): string {
  return path.join(resolveDataDir(), "oauth", `${providerId}.json`);
}

async function readRaw(providerId: string): Promise<Partial<OAuthCredentials>> {
  try {
    return JSON.parse(
      await readFile(credentialsPath(providerId), "utf8"),
    ) as Partial<OAuthCredentials>;
  } catch {
    return {};
  }
}

async function writeRaw(providerId: string, creds: Partial<OAuthCredentials>): Promise<void> {
  const filePath = credentialsPath(providerId);
  await mkdir(path.dirname(filePath), { recursive: true });
  const payload = JSON.stringify({ ...creds, updatedAt: new Date().toISOString() }, null, 2);
  await writeFile(filePath, `${payload}\n`, "utf8");
  try {
    await chmod(filePath, 0o600);
  } catch {
    // best-effort on platforms without POSIX perms
  }
}

function firstEnv(names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return "";
}

function appClientCredentials(provider: OAuthProvider): EffectiveClient | null {
  const clientId = firstEnv(provider.clientIdEnvVars);
  const clientSecret = firstEnv(provider.clientSecretEnvVars);
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, configuredByApp: true };
}

async function readEffectiveClient(provider: OAuthProvider): Promise<EffectiveClient | null> {
  const appClient = appClientCredentials(provider);
  if (appClient) return appClient;
  const creds = await readRaw(provider.id);
  if (!creds.clientId || !creds.clientSecret) return null;
  return { clientId: creds.clientId, clientSecret: creds.clientSecret, configuredByApp: false };
}

export async function getOAuthStatus(providerId: string): Promise<OAuthStatus> {
  const provider = requireProvider(providerId);
  const creds = await readRaw(providerId);
  const appClient = appClientCredentials(provider);
  const hasLocalCredentials = Boolean(creds.clientId && creds.clientSecret);
  return {
    providerId: provider.id,
    displayName: provider.displayName,
    hasCredentials: Boolean(appClient) || hasLocalCredentials,
    configuredByApp: Boolean(appClient),
    // Providers that don't issue refresh tokens are "connected" once they hold
    // an access token; refreshable providers require the refresh token.
    connected: provider.refreshable ? Boolean(creds.refreshToken) : Boolean(creds.accessToken),
    email: creds.email ?? "",
    scopes: creds.scopes ?? [],
    accessTokenExpiresAt: creds.accessTokenExpiresAt ?? 0,
  };
}

export async function getAllOAuthStatuses(): Promise<OAuthStatus[]> {
  return Promise.all(OAUTH_PROVIDERS.map((provider) => getOAuthStatus(provider.id)));
}

export async function saveOAuthClient(
  providerId: string,
  clientId: string,
  clientSecret: string,
): Promise<void> {
  requireProvider(providerId);
  const existing = await readRaw(providerId);
  await writeRaw(providerId, {
    ...existing,
    clientId: clientId.trim(),
    clientSecret: clientSecret.trim(),
  });
}

export async function disconnectOAuth(providerId: string): Promise<void> {
  requireProvider(providerId);
  const existing = await readRaw(providerId);
  await writeRaw(providerId, {
    clientId: existing.clientId ?? "",
    clientSecret: existing.clientSecret ?? "",
    refreshToken: "",
    accessToken: "",
    accessTokenExpiresAt: 0,
    email: "",
    scopes: [],
  });
}

export async function buildAuthUrl(
  providerId: string,
  redirectUri: string,
  state: string,
): Promise<string> {
  const provider = requireProvider(providerId);
  const client = await readEffectiveClient(provider);
  if (!client) {
    throw new Error(`${provider.displayName} OAuth is not configured for this app.`);
  }
  const params = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: provider.scopes.join(" "),
    state,
    ...(provider.authParams ?? {}),
  });
  return `${provider.authEndpoint}?${params.toString()}`;
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

function decodeIdTokenEmail(idToken: string | undefined): string {
  if (!idToken) return "";
  const segment = idToken.split(".")[1];
  if (!segment) return "";
  try {
    const json = Buffer.from(segment, "base64url").toString("utf8");
    const payload = JSON.parse(json) as { email?: string };
    return payload.email ?? "";
  } catch {
    return "";
  }
}

async function postToken(provider: OAuthProvider, body: URLSearchParams): Promise<TokenResponse> {
  const response = await fetch(provider.tokenEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      // GitHub returns form-encoded by default; ask for JSON everywhere.
      accept: "application/json",
    },
    body: body.toString(),
  });
  const data = (await response.json()) as TokenResponse;
  if (!response.ok || data.error) {
    throw new Error(
      data.error_description || data.error || `Token request failed (${response.status}).`,
    );
  }
  return data;
}

async function resolveAccountLabel(
  provider: OAuthProvider,
  data: TokenResponse,
  accessToken: string,
): Promise<string> {
  if (provider.oidcEmail) return decodeIdTokenEmail(data.id_token);
  if (!provider.accountEndpoint || !accessToken) return "";
  try {
    const response = await fetch(provider.accountEndpoint, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: "application/json",
        "user-agent": "local-studio",
      },
    });
    if (!response.ok) return "";
    const json = (await response.json()) as Record<string, unknown>;
    const field = provider.accountField ?? "email";
    const value = json[field];
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

export async function exchangeOAuthCode(
  providerId: string,
  code: string,
  redirectUri: string,
): Promise<void> {
  const provider = requireProvider(providerId);
  const [creds, client] = await Promise.all([readRaw(providerId), readEffectiveClient(provider)]);
  if (!client) {
    throw new Error(`Missing ${provider.displayName} OAuth client credentials.`);
  }
  const data = await postToken(
    provider,
    new URLSearchParams({
      code,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  );
  if (provider.refreshable && !data.refresh_token) {
    throw new Error(
      `${provider.displayName} did not return a refresh token. Revoke prior access and try again.`,
    );
  }
  const accessToken = data.access_token ?? "";
  await writeRaw(providerId, {
    ...creds,
    refreshToken: data.refresh_token ?? "",
    accessToken,
    accessTokenExpiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : 0,
    email: await resolveAccountLabel(provider, data, accessToken),
    scopes: data.scope ? data.scope.split(/[ ,]+/).filter(Boolean) : provider.scopes,
  });
}

export async function getFreshOAuthCredentials(
  providerId: string,
): Promise<FreshOAuthCredentials | null> {
  const provider = requireProvider(providerId);
  const [creds, client] = await Promise.all([readRaw(providerId), readEffectiveClient(provider)]);
  if (!creds.accessToken && !creds.refreshToken) return null;
  if (!client) return null;

  const expiresAt = creds.accessTokenExpiresAt ?? 0;
  const tokenStillValid =
    Boolean(creds.accessToken) &&
    // expiresAt === 0 means a non-expiring token (e.g. GitHub OAuth app).
    (expiresAt === 0 || Date.now() < expiresAt - REFRESH_SKEW_MS);
  if (tokenStillValid) {
    return {
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      refreshToken: creds.refreshToken ?? "",
      accessToken: creds.accessToken ?? "",
      expiresAt,
    };
  }

  // Token expired (or absent) — only refreshable providers can recover.
  if (!provider.refreshable || !creds.refreshToken) return null;

  const data = await postToken(
    provider,
    new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: creds.refreshToken,
      grant_type: "refresh_token",
    }),
  );
  const accessToken = data.access_token ?? "";
  const nextExpiresAt = data.expires_in ? Date.now() + data.expires_in * 1000 : 0;
  await writeRaw(providerId, {
    ...creds,
    accessToken,
    accessTokenExpiresAt: nextExpiresAt,
  });
  return {
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    refreshToken: creds.refreshToken,
    accessToken,
    expiresAt: nextExpiresAt,
  };
}
