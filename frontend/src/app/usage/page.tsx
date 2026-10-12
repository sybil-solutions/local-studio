import { SettingsRedirect } from "@/features/settings/settings-redirect";

// Usage is a Settings section now, the way Cursor treats Plan & Usage.
export default function Page() {
  return <SettingsRedirect fallback="usage" />;
}
