import type { BrowserBackend } from "@/features/agent/tools/types";

type BrowserContextPromptInput = {
  enabled: boolean;
  backend: BrowserBackend;
  url: string;
  vision: boolean;
};

export function browserContextPrompt({
  enabled,
  backend,
  url,
  vision,
}: BrowserContextPromptInput): string {
  if (!enabled) return "";
  const activeUrl = url && url !== "about:blank" ? url : "about:blank";
  return [
    "<browser_context>",
    "A server-side browser is available this turn via the browser_* tools; navigation and reads run on the host, and the user may optionally watch it in the Browser panel.",
    `Backend: ${backend}.`,
    `Active URL: ${activeUrl}.`,
    "The page body has not been preloaded into this prompt. To inspect it, call browser_get_text or browser_get_html first.",
    vision
      ? "Screenshots are available on demand with browser_screenshot when visual layout matters."
      : "This model may not be vision-capable; prefer browser_get_text/browser_get_html over browser_screenshot.",
    "Use browser_navigate only for intentional navigation.",
    // Counter the narrate-and-stop failure mode: when the browser is open, models
    // tend to emit a one-line plan ("Let me check X, then rebuild Y") with NO
    // tool call and stop — the agent loop ends the turn and nothing happens until
    // the user nudges "go on". Tell the model to ACT in the same turn instead.
    "When you state a plan, carry it out in the SAME turn by calling the tools you described — do not end your turn after only saying what you will do. Keep going until the task is complete, narrating briefly as you act.",
    "</browser_context>",
  ].join("\n");
}
