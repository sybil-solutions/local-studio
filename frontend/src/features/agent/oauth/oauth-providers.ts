// Provider-agnostic OAuth registry.
//
// This is the single source of truth for every OAuth provider the app can
// connect. It is intentionally pure data (no Node imports) so both the server
// (token store, routes, managed-token injection) and the client (Connections
// panel, plugin utils) can import it.
//
// Adding a new "Connect with <X>" button is a data change here plus a catalogue
// entry tagged with `oauthProvider: "<id>"` — no new bespoke flow.

/** How a connected provider's tokens are injected into an MCP server's env. */
export type OAuthEnvMapping = {
  /** Required: env var that receives the fresh access token. */
  accessToken: string;
  /** Optional: env var that receives the OAuth client id. */
  clientId?: string;
  /** Optional: env var that receives the OAuth client secret. */
  clientSecret?: string;
  /** Optional: env var that receives the long-lived refresh token. */
  refreshToken?: string;
};

export type OAuthProvider = {
  /** Stable id; also the credentials filename (`<dataDir>/oauth/<id>.json`). */
  id: string;
  displayName: string;
  authEndpoint: string;
  tokenEndpoint: string;
  scopes: string[];
  /** Extra params appended to the authorize URL (provider-specific). */
  authParams?: Record<string, string>;
  /** App-level client id env vars, checked in order. */
  clientIdEnvVars: string[];
  /** App-level client secret env vars, checked in order. */
  clientSecretEnvVars: string[];
  envMapping: OAuthEnvMapping;
  /** Whether the provider issues refresh tokens (Google: yes, GitHub OAuth app: no). */
  refreshable: boolean;
  /** Decode the connected account email from an OIDC `id_token`. */
  oidcEmail?: boolean;
  /** Userinfo endpoint to GET (Bearer) for an account label when not OIDC. */
  accountEndpoint?: string;
  /** Field in the userinfo JSON to use as the account label. */
  accountField?: string;
  /** Short helper text shown under the connection button. */
  description: string;
};

export const OAUTH_PROVIDERS: OAuthProvider[] = [
  {
    id: "google",
    displayName: "Google",
    authEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenEndpoint: "https://oauth2.googleapis.com/token",
    scopes: [
      "openid",
      "email",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/calendar",
    ],
    authParams: {
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
    },
    clientIdEnvVars: [
      "LOCAL_STUDIO_GOOGLE_OAUTH_CLIENT_ID",
      "GOOGLE_OAUTH_CLIENT_ID",
      "GOOGLE_CLIENT_ID",
    ],
    clientSecretEnvVars: [
      "LOCAL_STUDIO_GOOGLE_OAUTH_CLIENT_SECRET",
      "GOOGLE_OAUTH_CLIENT_SECRET",
      "GOOGLE_CLIENT_SECRET",
    ],
    envMapping: {
      clientId: "GOOGLE_CLIENT_ID",
      clientSecret: "GOOGLE_CLIENT_SECRET",
      refreshToken: "GOOGLE_REFRESH_TOKEN",
      accessToken: "GOOGLE_ACCESS_TOKEN",
    },
    refreshable: true,
    oidcEmail: true,
    description:
      "Connect Google once. OAuth-capable MCP servers (Gmail, Calendar, Workspace) use the refreshable token automatically; no plugin env or key fields are needed.",
  },
  {
    id: "github",
    displayName: "GitHub",
    authEndpoint: "https://github.com/login/oauth/authorize",
    tokenEndpoint: "https://github.com/login/oauth/access_token",
    scopes: ["repo", "read:org", "read:user"],
    clientIdEnvVars: ["LOCAL_STUDIO_GITHUB_OAUTH_CLIENT_ID", "GITHUB_OAUTH_CLIENT_ID"],
    clientSecretEnvVars: ["LOCAL_STUDIO_GITHUB_OAUTH_CLIENT_SECRET", "GITHUB_OAUTH_CLIENT_SECRET"],
    envMapping: {
      // The GitHub MCP server reads its token from GITHUB_PERSONAL_ACCESS_TOKEN;
      // an OAuth user-to-server token works in place of a PAT.
      accessToken: "GITHUB_PERSONAL_ACCESS_TOKEN",
    },
    refreshable: false,
    accountEndpoint: "https://api.github.com/user",
    accountField: "login",
    description:
      "Connect GitHub with OAuth instead of pasting a personal access token. The GitHub MCP server uses the connected token automatically.",
  },
  {
    id: "huggingface",
    displayName: "Hugging Face",
    authEndpoint: "https://huggingface.co/oauth/authorize",
    tokenEndpoint: "https://huggingface.co/oauth/token",
    scopes: ["openid", "profile", "email", "read-repos", "inference-api"],
    clientIdEnvVars: ["LOCAL_STUDIO_HF_OAUTH_CLIENT_ID", "HF_OAUTH_CLIENT_ID"],
    clientSecretEnvVars: ["LOCAL_STUDIO_HF_OAUTH_CLIENT_SECRET", "HF_OAUTH_CLIENT_SECRET"],
    envMapping: {
      accessToken: "HF_TOKEN",
    },
    refreshable: false,
    accountEndpoint: "https://huggingface.co/oauth/userinfo",
    accountField: "preferred_username",
    description:
      "Connect Hugging Face once. The official Hugging Face MCP server receives the connected token automatically.",
  },
];

export function getOAuthProvider(id: string): OAuthProvider | null {
  return OAUTH_PROVIDERS.find((provider) => provider.id === id) ?? null;
}

/** Every env var name that a connected provider manages (injected at launch). */
export function managedOAuthEnvKeys(): Set<string> {
  const keys = new Set<string>();
  for (const provider of OAUTH_PROVIDERS) {
    const { accessToken, clientId, clientSecret, refreshToken } = provider.envMapping;
    for (const key of [accessToken, clientId, clientSecret, refreshToken]) {
      if (key) keys.add(key);
    }
  }
  return keys;
}

export function isManagedOAuthEnvKey(key: string): boolean {
  return managedOAuthEnvKeys().has(key);
}

/** Resolve which provider an env map belongs to (by its access-token key). */
export function providerForEnvKeys(env: Record<string, string> | undefined): OAuthProvider | null {
  if (!env) return null;
  const keys = Object.keys(env);
  return (
    OAUTH_PROVIDERS.find(
      (provider) =>
        keys.includes(provider.envMapping.accessToken) ||
        (provider.envMapping.refreshToken
          ? keys.includes(provider.envMapping.refreshToken)
          : false),
    ) ?? null
  );
}
