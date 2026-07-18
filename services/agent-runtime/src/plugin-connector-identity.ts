import type { ConnectorConfig } from "./connector-contract";

export function clearedPluginConnector(connector: ConnectorConfig): ConnectorConfig {
  const origin = connector.origin;
  const clearedOrigin = origin
    ? {
        kind: origin.kind,
        id: origin.id,
        ...(origin.version ? { version: origin.version } : {}),
        ...(origin.binding ? { binding: origin.binding } : {}),
        ...(origin.artifactDigest ? { artifactDigest: origin.artifactDigest } : {}),
        ...(origin.executable ? { executable: origin.executable } : {}),
      }
    : undefined;
  return {
    ...connector,
    allowTools: [],
    permissionReviewed: false,
    ...(clearedOrigin ? { origin: clearedOrigin } : {}),
    enabled: false,
  };
}
