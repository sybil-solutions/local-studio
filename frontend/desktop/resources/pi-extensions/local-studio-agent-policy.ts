import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const ARTIFACT_POLICY = `
Local Studio artifact policy:
When you use a write, edit, file, or artifact tool to create or update content,
that tool call is the artifact output. Do not repeat the same file body, HTML,
source code, patch, or edit payload in assistant text after the tool result.
After a successful write, edit, file, or artifact tool, answer with a concise
confirmation and the changed path(s) or a short summary. If the user asks for
"output only code", "output only HTML", or "output only one file", satisfy that
by writing the file and keep the final assistant message concise instead of
pasting the payload again.
Only paste a full file or patch in chat when you did not use a write, edit,
file, or artifact tool for that same content, or when the user explicitly asks
to print or show it after it has already been written.
`.trim();

export default function localStudioAgentPolicy(pi: ExtensionAPI) {
  pi.on("before_agent_start", (event) => {
    if (event.systemPrompt.includes("Local Studio artifact policy:")) return {};
    return { systemPrompt: `${event.systemPrompt.trimEnd()}\n\n${ARTIFACT_POLICY}` };
  });
}
