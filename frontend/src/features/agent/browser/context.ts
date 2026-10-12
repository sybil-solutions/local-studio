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
    "A headless browser is available this turn via the browser_* tools; navigation and reads run on the host in a throwaway profile with no logins, and the user may optionally watch it in the Browser panel.",
    `Active URL in that browser: ${activeUrl}.`,
    "The page body has not been preloaded into this prompt. To inspect it, call browser_get_text or browser_get_html first.",
    "browser_history returns what this browser has already done and visited this session, including navigation the user drove in the panel — check it before redoing work.",
    // Two browsers, two vocabularies. Naming the second one here is what stops
    // the model reporting an empty inbox from a signed-out sandbox.
    ...(backend === "chrome"
      ? [
          "The user has ALSO armed their own browser, driven by the chrome_* tools: their real window, profile, logins and tabs, visible on their screen. Use chrome_* whenever the task needs their session — anything behind a sign-in, or a page they already have open — and browser_* for anonymous or throwaway fetching. The two do not share state.",
          "Actions taken with chrome_* happen as the user, in public, and can be irreversible. Do not click, submit, or close anything there that they did not ask for.",
        ]
      : [
          "The user's own browser is NOT available this turn. If a task needs their logged-in session, say so and tell them they can arm Chrome from the composer's browser button — do not pretend the headless browser is signed in.",
        ]),
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
