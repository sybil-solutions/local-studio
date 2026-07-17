import { permanentRedirect } from "next/navigation";

export default function IntegrationsRedirect() {
  permanentRedirect("/configure?section=integrations#integrations");
}
