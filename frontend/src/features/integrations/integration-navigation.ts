export const INTEGRATION_SECTION_IDS = ["plugins", "connectors", "models", "skills"] as const;

export type IntegrationSectionId = (typeof INTEGRATION_SECTION_IDS)[number];

export function integrationSectionFromHash(hash: string): IntegrationSectionId {
  const section = hash.replace(/^#/, "");
  return INTEGRATION_SECTION_IDS.find((candidate) => candidate === section) ?? "plugins";
}

export function legacyIntegrationHref(hash: string): string | null {
  const section = hash.replace(/^#/, "");
  if (section !== "connectors" && section !== "skills") return null;
  return `/configure?integration=${section}#integrations`;
}
