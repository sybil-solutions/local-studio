import { permanentRedirect } from "next/navigation";

export default function DiscoverRedirect() {
  permanentRedirect("/configure?section=models#models");
}
