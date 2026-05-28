import type { ChatMessage } from "@/lib/agent/session";
import { SessionPaneBlockRouter } from "./session-pane-block-router";

export function MessageView({ message }: { message: ChatMessage }) {
  return <SessionPaneBlockRouter message={message} />;
}
