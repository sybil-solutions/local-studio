import type { BrowserBackend } from "@/lib/agent/tools/types";

type BrowserContextPromptInput = {
  enabled: boolean;
  backend: BrowserBackend;
  url: string;
  modelId: string;
};

const VISION_MODEL_NEEDLES = [
  "4o",
  "vision",
  "vl",
  "qwen2.5-vl",
  "qwen3-vl",
  "gemma-3",
  "llava",
  "pixtral",
];

export function modelLikelySupportsVision(modelId: string): boolean {
  const normalized = modelId.toLowerCase();
  return VISION_MODEL_NEEDLES.some((needle) => normalized.includes(needle));
}

export function browserContextPrompt({
  enabled,
  backend,
  url,
  modelId,
}: BrowserContextPromptInput): string {
  if (!enabled) return "";
  const activeUrl = url && url !== "about:blank" ? url : "about:blank";
  const vision = modelLikelySupportsVision(modelId);
  return [
    "<browser_context>",
    "The in-app Browser is open for this turn. Browser tools are available only because the Browser panel is open.",
    `Backend: ${backend}.`,
    `Active URL: ${activeUrl}.`,
    "The page body has not been preloaded into this prompt. To inspect it, call browser_get_text or browser_get_html first.",
    vision
      ? "Screenshots are available on demand with browser_screenshot when visual layout matters."
      : "This model may not be vision-capable; prefer browser_get_text/browser_get_html over browser_screenshot.",
    "Use browser_navigate only for intentional navigation, and describe browser actions/results visibly to the user.",
    "</browser_context>",
  ].join("\n");
}
