/**
 * Launch configurations Local Studio already knows how to write.
 *
 * This is a starting point for the editor, not a store and not a marketplace.
 * Picking an entry fills the same form a hand-written connector uses, with the
 * same command preview and the same "nothing runs until you enable it" rule —
 * there is no install step, nothing is fetched from a URL, and no third party
 * decides what lands in the list. Growing the list is a code change, which is
 * the point: every entry here is a command someone reviewed.
 *
 * The `{{SSH_REMOTE_SERVER}}` placeholder is the one exception to "these args
 * are literal": it is resolved against the MCP server bundled inside this app,
 * because the absolute path differs between a dev checkout and a signed build.
 */
import {
  OAUTH_CONNECTOR_PROVIDERS,
  type OAuthConnectorAuthDefinition,
} from "@local-studio/agent-runtime/oauth-connector-contract";

export const SSH_SERVER_PLACEHOLDER = "{{SSH_REMOTE_SERVER}}";

export interface CatalogEntry {
  id: string;
  name: string;
  company: string;
  description: string;
  transport: "stdio";
  command: string;
  args: string[];
  /**
   * `secret` is declared here, not inferred from the key's name: it decides
   * whether the stored value is masked on every read, so a credential whose
   * name matches no heuristic ("GITHUB_PAT") stays protected and a plain
   * setting whose name happens to ("SSH_HOST" is fine, "AUTH_MODE" was not)
   * stays readable.
   */
  envFields: Array<{ key: string; label: string; placeholder?: string; secret?: boolean }>;
  /**
   * Present when the provider supports OAuth: this entry connects with a
   * click, never with a pasted token. The runtime runs the flow (device code
   * or loopback PKCE), stores the grant, and injects a fresh access token into
   * `auth.tokenEnv` each time the MCP child is spawned — so an entry with
   * `auth` must declare no token-shaped env fields at all.
   */
  auth?: OAuthConnectorAuthDefinition;
}

export const CONNECTOR_CATALOG: CatalogEntry[] = [
  {
    id: "github",
    name: "GitHub",
    company: "GitHub",
    description: "Repos, issues, pull requests, and code search. Connects with GitHub sign-in.",
    transport: "stdio",
    command: OAUTH_CONNECTOR_PROVIDERS.github.connector.command,
    args: [...OAUTH_CONNECTOR_PROVIDERS.github.connector.args],
    envFields: [],
    auth: OAUTH_CONNECTOR_PROVIDERS.github.auth,
  },
  {
    // X stays on pasted keys, honestly: the bundled MCP package
    // (@enescinar/twitter-mcp) constructs an OAuth 1.0a user-context client
    // from API_KEY/API_SECRET_KEY/ACCESS_TOKEN/ACCESS_TOKEN_SECRET and has no
    // code path that accepts an OAuth 2.0 bearer token, so an X "Connect"
    // button would mint a token the server cannot use. If the package grows
    // bearer support, this entry becomes an `auth` entry like GitHub's.
    id: "x",
    name: "X / Twitter",
    company: "X",
    description: "Read and post with X API credentials.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@enescinar/twitter-mcp@0.2.0"],
    envFields: [
      { key: "API_KEY", label: "X API key", secret: true },
      { key: "API_SECRET_KEY", label: "X API secret", secret: true },
      { key: "ACCESS_TOKEN", label: "Access token", secret: true },
      { key: "ACCESS_TOKEN_SECRET", label: "Access token secret", secret: true },
    ],
  },
  {
    id: "computer",
    name: "Remote computer",
    company: "Local Studio",
    description: "Run commands and work with files over SSH on another machine.",
    transport: "stdio",
    command: "node",
    args: [SSH_SERVER_PLACEHOLDER],
    envFields: [
      { key: "SSH_HOST", label: "SSH host", placeholder: "user@machine", secret: false },
    ],
  },
];

/**
 * How a shell would read the argv this connector spawns.
 *
 * Rendered for the user rather than executed — the runtime passes argv to the
 * child process directly and never through a shell — so the quoting here is
 * about making a stray space visible, not about escaping for safety.
 */
export function renderCommandLine(command: string, args: readonly string[]): string {
  return [command, ...args]
    .filter((part) => part.length > 0)
    .map((part) => (/[\s"'\\$`]/.test(part) ? JSON.stringify(part) : part))
    .join(" ");
}
