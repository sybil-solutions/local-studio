export const CONFIGURE_SECTION_IDS = [
  "overview",
  "rig",
  "models",
  "integrations",
  "server",
] as const;

export type ConfigureSectionId = (typeof CONFIGURE_SECTION_IDS)[number];

export function configureSectionFromHash(hash: string): ConfigureSectionId {
  const section = hash.replace(/^#/, "");
  return CONFIGURE_SECTION_IDS.find((candidate) => candidate === section) ?? "overview";
}
