import { SettingsRedirect } from "@/features/settings/settings-redirect";

// Integrations collapsed into Settings (docs/cursor-restructure-plan.md):
// its tabs live on the Settings rail now. The hash names the tab; Settings'
// own alias table maps it to the right section.
export default function Page() {
  return <SettingsRedirect fallback="mcp" />;
}
