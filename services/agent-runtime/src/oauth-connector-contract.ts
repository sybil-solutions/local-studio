import { Schema } from "effect";

/**
 * OAuth definitions for catalog connectors, shared between the runtime (which
 * runs the flows and injects tokens) and the Integrations page (which renders
 * the Connect button). Pure data and schemas only — the frontend imports this
 * module directly, so nothing here may touch node builtins or the filesystem.
 *
 * The design rule this file carries: a catalog connector that a provider lets
 * us authorize via OAuth never asks the user to paste a token. The runtime
 * mints and refreshes the access token itself and hands it to the MCP child
 * process through the env var the server package already expects (`tokenEnv`),
 * so the server package needs no changes and the credential never appears in
 * a form, in connectors.json, or in a masked field.
 */

export const OAUTH_CONNECTOR_PROVIDER_IDS = ["github"] as const;
export type OAuthConnectorProviderId = (typeof OAUTH_CONNECTOR_PROVIDER_IDS)[number];

export type OAuthConnectorFlowKind = "oauth-device";

export type OAuthConnectorAuthDefinition = {
  kind: OAuthConnectorFlowKind;
  /**
   * A baked-in public client id, when the provider ships one. Absent means the
   * user registers a client once; `createClientUrl` deep-links the provider's
   * registration form pre-filled so that step is a click plus a paste of a
   * PUBLIC identifier, never a credential.
   */
  clientId?: string;
  /** Env var that overrides the stored client id, for packaged deployments. */
  clientIdEnv: string;
  /** Device-code endpoint. */
  deviceUrl?: string;
  tokenUrl: string;
  scopes: readonly string[];
  /** The env var the MCP child receives the access token in. */
  tokenEnv: string;
  /** Endpoint that names the signed-in account, and the field that carries it. */
  identityUrl: string;
  identityField: string;
  /** Deep link to the provider's app-registration form, pre-filled. */
  createClientUrl: string;
  /** The one-time registration steps, stated where the client id is asked for. */
  setupHint: string;
};

export type OAuthConnectorProvider = {
  id: OAuthConnectorProviderId;
  name: string;
  auth: OAuthConnectorAuthDefinition;
  /** The MCP server this provider's connector row spawns. */
  connector: { command: string; args: readonly string[] };
};

/**
 * GitHub ships the device flow, not an app-manifest bootstrap, deliberately.
 * The manifest conversion (`/app-manifests/{code}/conversions`) mints a GitHub
 * App, but a GitHub App's user-to-server token only reaches repositories the
 * app is also *installed* on — a fresh manifest app sees an empty world until
 * the user walks an installation flow per repo — and the manifest JSON has no
 * field that enables the device flow. A classic OAuth app with "Enable Device
 * Flow" ticked issues tokens with real `repo` scope that work everywhere
 * immediately, which is what the bundled GitHub MCP server expects. So the
 * one-time cost is registering that app (deep-linked, pre-filled), and every
 * connect after that is: click Connect, type the shown code into github.com.
 */
export const OAUTH_CONNECTOR_PROVIDERS: Record<OAuthConnectorProviderId, OAuthConnectorProvider> = {
  github: {
    id: "github",
    name: "GitHub",
    auth: {
      kind: "oauth-device",
      clientIdEnv: "LOCAL_STUDIO_GITHUB_CLIENT_ID",
      deviceUrl: "https://github.com/login/device/code",
      tokenUrl: "https://github.com/login/oauth/access_token",
      scopes: ["repo", "read:org"],
      tokenEnv: "GITHUB_PERSONAL_ACCESS_TOKEN",
      identityUrl: "https://api.github.com/user",
      identityField: "login",
      createClientUrl:
        "https://github.com/settings/applications/new" +
        "?oauth_application[name]=Local%20Studio" +
        "&oauth_application[url]=https%3A%2F%2Fgithub.com%2F0xsero%2Fvllm-studio" +
        "&oauth_application[callback_url]=http%3A%2F%2F127.0.0.1%2Fcallback",
      setupHint:
        "Register the pre-filled OAuth app, tick “Enable Device Flow” on its settings page, " +
        "then paste its Client ID here. The Client ID is a public identifier, not a secret, " +
        "and no client secret is needed.",
    },
    connector: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github@2025.4.8"],
    },
  },
};

export function oauthConnectorProvider(connectorId: string): OAuthConnectorProvider | null {
  return (OAUTH_CONNECTOR_PROVIDER_IDS as readonly string[]).includes(connectorId)
    ? OAUTH_CONNECTOR_PROVIDERS[connectorId as OAuthConnectorProviderId]
    : null;
}

const PendingDeviceSchema = Schema.Struct({
  userCode: Schema.String,
  verificationUri: Schema.String,
  expiresAt: Schema.Number,
});

export const OAuthAuthorizeResponseSchema = Schema.Struct({
  flow: Schema.Literal("device"),
  userCode: Schema.String,
  verificationUri: Schema.String,
  expiresAt: Schema.Number,
});

export const OAuthStatusResponseSchema = Schema.Struct({
  connectorId: Schema.String,
  /** Whether a client id exists (stored or baked or env), so Connect can run. */
  configured: Schema.Boolean,
  clientId: Schema.NullOr(Schema.String),
  connected: Schema.Boolean,
  account: Schema.NullOr(Schema.String),
  expiresAt: Schema.NullOr(Schema.Number),
  scopes: Schema.Array(Schema.String),
  /** Live device flow, if one is waiting on the user right now. */
  pending: Schema.NullOr(PendingDeviceSchema),
  /** How the last flow failed, if it failed; cleared when a new one starts. */
  error: Schema.NullOr(Schema.String),
});

export const OAuthClientInputSchema = Schema.Struct({
  connectorId: Schema.String,
  clientId: Schema.String,
});

export const OAuthConnectorInputSchema = Schema.Struct({
  connectorId: Schema.String,
});

export type OAuthAuthorizeResponse = typeof OAuthAuthorizeResponseSchema.Type;
export type OAuthStatusResponse = typeof OAuthStatusResponseSchema.Type;
