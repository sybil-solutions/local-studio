import { SettingsRedirect } from "@/features/settings/settings-redirect";

// Configure's two tenants (Machines, Server) live on the Settings rail now.
export default function Page() {
  return <SettingsRedirect fallback="machines" />;
}
