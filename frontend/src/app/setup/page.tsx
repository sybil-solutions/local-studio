import { SettingsRedirect } from "@/features/settings/settings-redirect";

// The first-run wizard is gone (owner call: it was broken more often than it
// helped). Old links land on Settings' own Setup checks section.
export default function Page() {
  return <SettingsRedirect fallback="setup" />;
}
