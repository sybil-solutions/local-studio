export const INTEGRATION_SECTION_IDS = ["connectors", "skills"] as const;

export type IntegrationSectionId = (typeof INTEGRATION_SECTION_IDS)[number];

export function integrationSectionFromHash(hash: string): IntegrationSectionId {
  const section = hash.replace(/^#/, "");
  return INTEGRATION_SECTION_IDS.find((candidate) => candidate === section) ?? "connectors";
}

export function legacyIntegrationHref(hash: string): string | null {
  const section = hash.replace(/^#/, "");
  if (section !== "connectors" && section !== "skills") return null;
  return `/integrations#${section}`;
}
