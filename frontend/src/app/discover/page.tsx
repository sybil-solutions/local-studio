import { permanentRedirect } from "next/navigation";

export default function DiscoverRedirect() {
  permanentRedirect("/configure#models");
}
