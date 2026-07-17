import { permanentRedirect } from "next/navigation";

export default function ServerRedirect() {
  permanentRedirect("/configure?section=server#server");
}
