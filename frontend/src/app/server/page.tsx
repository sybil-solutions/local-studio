import { permanentRedirect } from "next/navigation";

export default function ServerRedirect() {
  permanentRedirect("/settings#server");
}
