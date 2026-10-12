export const GOOGLE_WORKSPACE_PLUGIN_IDS = ["gmail", "google-calendar"] as const;
export type GoogleWorkspacePluginId = (typeof GOOGLE_WORKSPACE_PLUGIN_IDS)[number];

/**
 * How a signed-in account's read-only tools are actually reached.
 *
 * `rest` calls the long-lived public Google REST APIs (gmail.googleapis.com,
 * calendar.googleapis.com) through an in-process adapter that speaks the same
 * tool names as the remote server. `remote-mcp` calls Google's first-party
 * Workspace MCP servers, which are a developer preview: we have never been able
 * to confirm that a self-registered Desktop OAuth client is accepted there, so
 * it stays opt-in behind an environment flag rather than being a silent
 * fallback. Switching the flag changes the OAuth audience, so an account has to
 * be re-authorized after flipping it.
 */
export type GoogleWorkspaceTransport = "rest" | "remote-mcp";

export const GOOGLE_MCP_PREVIEW_ENV = "LOCAL_STUDIO_GOOGLE_MCP_PREVIEW";

export function googleWorkspaceTransport(flag: string | undefined): GoogleWorkspaceTransport {
  return flag === "1" ? "remote-mcp" : "rest";
}

type GoogleWorkspaceBinding = {
  name: string;
  /** Google's first-party MCP preview endpoint for this service. */
  mcpEndpoint: string;
  /** RFC 8707 audience the preview endpoint expects. Never sent on the REST path. */
  mcpResource: string;
  /** Public REST base the in-process adapter calls. */
  restEndpoint: string;
  scopes: readonly string[];
  observeTools: readonly string[];
  verifyTool: string;
};

export const GOOGLE_WORKSPACE_BINDINGS: Record<GoogleWorkspacePluginId, GoogleWorkspaceBinding> = {
  gmail: {
    name: "Gmail",
    mcpEndpoint: "https://gmailmcp.googleapis.com/mcp/v1",
    mcpResource: "https://gmailmcp.googleapis.com/mcp",
    restEndpoint: "https://gmail.googleapis.com/gmail/v1",
    scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    observeTools: ["list_drafts", "get_thread", "get_message", "search_threads", "list_labels"],
    verifyTool: "list_labels",
  },
  "google-calendar": {
    name: "Google Calendar",
    mcpEndpoint: "https://calendarmcp.googleapis.com/mcp/v1",
    mcpResource: "https://calendarmcp.googleapis.com/mcp/v1",
    restEndpoint: "https://www.googleapis.com/calendar/v3",
    scopes: [
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
      "https://www.googleapis.com/auth/calendar.events.freebusy",
      "https://www.googleapis.com/auth/calendar.events.readonly",
    ],
    observeTools: ["list_events", "get_event", "list_calendars", "suggest_time"],
    verifyTool: "list_calendars",
  },
};

export function googleWorkspaceEndpoint(
  service: GoogleWorkspacePluginId,
  transport: GoogleWorkspaceTransport,
): string {
  const binding = GOOGLE_WORKSPACE_BINDINGS[service];
  return transport === "remote-mcp" ? binding.mcpEndpoint : binding.restEndpoint;
}

export function isGoogleWorkspaceEndpoint(service: GoogleWorkspacePluginId, url: string): boolean {
  const binding = GOOGLE_WORKSPACE_BINDINGS[service];
  return url === binding.mcpEndpoint || url === binding.restEndpoint;
}

/** The transport a stored connector row is already pointed at. */
export function googleWorkspaceEndpointTransport(
  service: GoogleWorkspacePluginId,
  url: string,
): GoogleWorkspaceTransport {
  return url === GOOGLE_WORKSPACE_BINDINGS[service].mcpEndpoint ? "remote-mcp" : "rest";
}

function isGoogleWorkspacePlugin(id: string): id is GoogleWorkspacePluginId {
  return id === "gmail" || id === "google-calendar";
}

/**
 * Accounts are addressed by a short digest of the verified email rather than by
 * the address itself: connector ids are a restricted character set, and the
 * digest keeps a mailbox out of filenames and tool names while still being
 * stable across sign-ins.
 */
export const GOOGLE_ACCOUNT_KEY_PATTERN = /^[0-9a-f]{10}$/;

const SERVICE_SLUGS: Record<GoogleWorkspacePluginId, string> = {
  gmail: "gmail",
  "google-calendar": "calendar",
};

const CONNECTOR_ID_PATTERN = /^account-google-(gmail|calendar)-([0-9a-f]{10})$/;

export type GoogleWorkspaceIdentity = {
  service: GoogleWorkspacePluginId;
  accountKey: string;
};

export function googleWorkspaceConnectorId(
  service: GoogleWorkspacePluginId,
  accountKey: string,
): string {
  return `account-google-${SERVICE_SLUGS[service]}-${accountKey}`;
}

export function googleWorkspaceConnectorIdentity(id: string): GoogleWorkspaceIdentity | null {
  const match = CONNECTOR_ID_PATTERN.exec(id);
  if (!match?.[1] || !match[2]) return null;
  return {
    service: match[1] === "gmail" ? "gmail" : "google-calendar",
    accountKey: match[2],
  };
}

/**
 * Connector ids minted before accounts were multi-tenant. They carry no account
 * key, so they can no longer name a grant; they are normalized to a disabled
 * placeholder on load and replaced the first time the account is authorized.
 */
const LEGACY_GOOGLE_WORKSPACE_CONNECTOR_IDS: Record<GoogleWorkspacePluginId, string> = {
  gmail: "account-google-gmail",
  "google-calendar": "account-google-calendar",
};

export function legacyGoogleWorkspaceService(id: string): GoogleWorkspacePluginId | null {
  return (
    GOOGLE_WORKSPACE_PLUGIN_IDS.find(
      (service) => LEGACY_GOOGLE_WORKSPACE_CONNECTOR_IDS[service] === id,
    ) ?? null
  );
}

export function googleWorkspaceAuthAccount(identity: GoogleWorkspaceIdentity): string {
  return `${identity.accountKey}:${identity.service}`;
}
