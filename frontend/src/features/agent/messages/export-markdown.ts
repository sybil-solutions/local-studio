import type { AssistantBlock, ChatMessage } from "@/features/agent/messages";

/** Visible answer text of an assistant turn — its text blocks joined, falling
 * back to the flat `text` field. Reasoning/tool/event blocks are omitted so the
 * export is the clean conversation, not the scratch work. */
function assistantAnswerText(message: ChatMessage): string {
  const fromBlocks = (message.blocks ?? [])
    .map((block: AssistantBlock) => (block.kind === "text" ? block.text : ""))
    .filter(Boolean)
    .join("\n\n")
    .trim();
  return fromBlocks || message.text.trim();
}

/** Serialize a chat transcript to portable Markdown: a title heading, then each
 * turn under a `## You` / `## Assistant` heading. Empty and system turns are
 * skipped. Pure — the download side-effect lives at the call site. */
export function sessionToMarkdown(messages: ChatMessage[], title?: string): string {
  const lines: string[] = [];
  const heading = (title ?? "").trim();
  if (heading) lines.push(`# ${heading}`, "");
  for (const message of messages) {
    if (message.role === "system") continue;
    const body = message.role === "user" ? message.text.trim() : assistantAnswerText(message);
    if (!body) continue;
    lines.push(message.role === "user" ? "## You" : "## Assistant", "", body, "");
  }
  return `${lines.join("\n").trim()}\n`;
}

/** A filesystem-safe `.md` filename derived from the session title. */
export function exportFilenameFromTitle(title: string | undefined): string {
  const base =
    (title ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "chat";
  return `${base}.md`;
}
