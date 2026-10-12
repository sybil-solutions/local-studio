import { generatedSessionTitle, sessionTitleFromUserPrompt } from "../../../../shared/agent/session-title";
import { getApiSettings } from "../settings-service";
import { setSessionTitle } from "../session-metadata-store";
import { errorMessage, jsonError, readJsonBody } from "./helpers";

const TITLE_PROMPT_LIMIT = 800;
const TITLE_TIMEOUT_MS = 12_000;

function servedModelId(modelId: string): string {
  const trimmed = modelId.trim();
  const slash = trimmed.lastIndexOf("/");
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

function completionText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return "";
  const message = (choices[0] as { message?: { content?: unknown } }).message;
  if (typeof message?.content === "string") return message.content;
  return "";
}

export async function handleGenerateSessionTitle(
  request: Request,
  sessionId: string,
): Promise<Response> {
  const id = sessionId.trim();
  if (!id) return jsonError("session id is required");
  const body = await readJsonBody(request, { maxChars: 16_384 });
  const prompt = sessionTitleFromUserPrompt(
    typeof body?.prompt === "string" ? body.prompt : "",
  );
  const modelId = typeof body?.modelId === "string" ? body.modelId : "";
  if (!prompt) return jsonError("prompt is required");
  if (!modelId.trim()) return jsonError("modelId is required");
  try {
    const settings = await getApiSettings();
    const backend = settings.backendUrl.replace(/\/+$/, "");
    const headers: HeadersInit = { "Content-Type": "application/json" };
    if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
    const response = await fetch(`${backend}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: servedModelId(modelId),
        stream: false,
        stop: ["\n"],
        messages: [
          {
            role: "system",
            content:
              "Reply with a short session title only. 3 to 8 words. No quotes, no punctuation at the ends, no emoji.",
          },
          { role: "user", content: prompt.slice(0, TITLE_PROMPT_LIMIT) },
        ],
      }),
      signal: AbortSignal.timeout(TITLE_TIMEOUT_MS),
    });
    if (!response.ok) {
      return jsonError(`Title model failed with HTTP ${response.status}`, 502);
    }
    const title = generatedSessionTitle(completionText(await response.json()));
    if (!title) return jsonError("Title model returned an empty title", 502);
    await setSessionTitle(id, title);
    return Response.json({ title });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to generate session title"), 502);
  }
}
