import {
  GITHUB_CONNECTOR_TOKEN_KEY,
  type ConnectorView,
} from "@local-studio/agent-runtime/connector-contract";

export function githubCredentialUpdate(token: string) {
  const normalized = token.trim();
  if (!normalized) throw new Error("Enter a new personal access token");
  return {
    id: "github" as const,
    catalogId: "github" as const,
    env: { [GITHUB_CONNECTOR_TOKEN_KEY]: normalized },
    enabled: true,
  };
}

export function hasStoredGitHubCredential(
  connector: Pick<ConnectorView, "secret_keys"> | null,
): boolean {
  return connector?.secret_keys.includes(GITHUB_CONNECTOR_TOKEN_KEY) ?? false;
}
