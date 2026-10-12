import { SettingsRedirect } from "@/features/settings/settings-redirect";

// The orphaned logs route: the same server view is the Settings → Server &
// logs section.
export default function Page() {
  return <SettingsRedirect fallback="server" />;
}
