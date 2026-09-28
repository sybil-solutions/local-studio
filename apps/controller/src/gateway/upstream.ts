import type { CMessage, CPart, CRequest, Json } from "./canonical";
import { partsText } from "./canonical";

const userContent = (parts: CPart[]): unknown =>
  parts.every((p) => p.type === "text")
    ? partsText(parts)
    : parts.map((p) => (p.type === "text" ? { type: "text", text: p.text } : { type: "image_url", image_url: { url: p.url } }));

const chatMessage = (m: CMessage): Json => {
  switch (m.role) {
    case "system":
      return { role: "system", content: m.text };
    case "user":
      return { role: "user", content: userContent(m.parts) };
    case "tool":
      return { role: "tool", tool_call_id: m.toolCallId, content: (m.isError ? "[tool error] " : "") + partsText(m.parts) };
    case "assistant": {
      const out: Json = { role: "assistant", content: m.text || (m.toolCalls.length ? null : "") };
      if (m.reasoning) out.reasoning_content = m.reasoning;
      if (m.toolCalls.length) out.tool_calls = m.toolCalls.map((t) => ({ id: t.id, type: "function", function: { name: t.name, arguments: t.args || "{}" } }));
      return out;
    }
  }
};

export const toChatBody = (req: CRequest, served: string): Json => {
  const body: Json = { ...req.extra, model: served, messages: req.messages.map(chatMessage), stream: true, stream_options: { include_usage: true } };
  if (req.tools.length)
    body.tools = req.tools.map((t) => ({
      type: "function",
      function: { name: t.name, ...(t.description ? { description: t.description } : {}), parameters: t.parameters ?? {}, ...(t.strict !== undefined ? { strict: t.strict } : {}) },
    }));
  if (req.toolChoice && req.tools.length) body.tool_choice = typeof req.toolChoice === "string" ? req.toolChoice : { type: "function", function: { name: req.toolChoice.name } };
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.topP !== undefined) body.top_p = req.topP;
  if (req.stop?.length) body.stop = req.stop;
  if (req.responseFormat) body.response_format = req.responseFormat;
  if (req.reasoning?.effort) body.reasoning_effort = req.reasoning.effort;
  if (req.reasoning?.enabled === false) {
    const kw = typeof body.chat_template_kwargs === "object" && body.chat_template_kwargs ? (body.chat_template_kwargs as Json) : {};
    body.chat_template_kwargs = { enable_thinking: false, ...kw };
  }
  for (const k of ["max_tokens", "max_completion_tokens", "max_output_tokens"]) delete body[k];
  return body;
};

export interface UpstreamOpen {
  res: Response;
  abort: AbortController;
}

export const CONNECT_TIMEOUT_MS = 60_000;

export const openUpstream = async (url: string, body: Json, headers: Record<string, string>, clientSignal: AbortSignal): Promise<UpstreamOpen> => {
  const abort = new AbortController();
  const onClient = () => abort.abort(new DOMException("client disconnected", "AbortError"));
  if (clientSignal.aborted) onClient();
  clientSignal.addEventListener("abort", onClient, { once: true });
  const timer = setTimeout(() => abort.abort(new DOMException("upstream connect timeout", "TimeoutError")), CONNECT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream", ...headers },
      body: JSON.stringify(body),
      signal: abort.signal,
      redirect: "manual",
    });
    return { res, abort };
  } finally {
    clearTimeout(timer);
  }
};
