"use client";

import { useRouter } from "next/navigation";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

/**
 * The forwarding stub the absorbed pages left behind (Configure, Usage, Logs,
 * Integrations → Settings sections). The section is carried in the hash or a
 * `?section=` query — both client-only — so this must be a client redirect.
 * The raw section name is passed through untranslated: Settings' own
 * `normalizeSectionId` already resolves every legacy alias.
 */
export function SettingsRedirect({ fallback }: { fallback: string }) {
  const router = useRouter();
  useMountSubscription(() => {
    const hash = window.location.hash.replace("#", "");
    const query = new URLSearchParams(window.location.search).get("section") ?? "";
    router.replace(`/settings#${hash || query || fallback}`);
  }, [router, fallback]);
  return null;
}
