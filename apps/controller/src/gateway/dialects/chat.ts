import type { ErrorCode, TokenBuckets } from "@local-studio/contracts";
import { bucketsFromOpenAiUsage, promptTotal } from "@local-studio/contracts";
import type { CEvent, CFinish, CMessage, CPart, CRequest, CTool, CToolChoice, Json } from "../canonical";
import { DialectError, arr, isObj, newId, num, openAiError, str } from "../canonical";

export const CHAT_CAP_KEYS = ["max_tokens", "max_completion_tokens", "max_output_tokens", "thinking_budget", "thinking_token_budget"];

const KNOWN = new Set([
  "model", "messages", "tools", "tool_choice", "stream", "stream_options", "temperature", "top_p", "stop", "response_format",
  "reasoning_effort", "n", ...CHAT_CAP_KEYS,
]);

const contentParts = (c: unknown): CPart[] => {
  if (typeof c === "string") return [{ type: "text", text: c }];
  const out: CPart[] = [];
  for (const p of arr(c)) {
    if (!isObj(p)) continue;
    if (p.type === "text" && typeof p.text === "string") out.push({ type: "text", text: p.text });
    else if (p.type === "image_url") {
      const url = isObj(p.image_url) ? str(p.image_url.url) : str(p.image_url);
      if (url) out.push({ type: "image", url });
    }
  }
  return out;
};

const textOf = (c: unknown): string =>
  contentParts(c)
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("");

export const decodeChatRequest = (body: Json): CRequest => {
  if ((num(body.n) ?? 1) > 1) throw new DialectError(400, "INVALID_REQUEST", "n > 1 is not supported");
  const messages: CMessage[] = [];
  for (const m of arr(body.messages)) {
    if (!isObj(m)) continue;
    if (m.role === "system" || m.role === "developer") messages.push({ role: "system", text: textOf(m.content) });
    else if (m.role === "user") messages.push({ role: "user", parts: contentParts(m.content) });
    else if (m.role === "tool") messages.push({ role: "tool", toolCallId: str(m.tool_call_id) ?? "", parts: contentParts(m.content), isError: false });
    else if (m.role === "assistant")
      messages.push({
        role: "assistant",
        text: textOf(m.content),
        reasoning: str(m.reasoning_content) ?? str(m.reasoning) ?? null,
        toolCalls: arr(m.tool_calls)
          .filter(isObj)
          .map((t) => {
            const f = isObj(t.function) ? t.function : {};
            return { id: str(t.id) ?? newId("call_"), name: str(f.name) ?? "", args: str(f.arguments) ?? "" };
          }),
      });
  }
  const tools: CTool[] = arr(body.tools)
    .filter(isObj)
    .map((t) => (isObj(t.function) ? t.function : t))
    .map((f) => ({ name: str(f.name) ?? "", description: str(f.description), parameters: f.parameters ?? {}, strict: typeof f.strict === "boolean" ? f.strict : undefined }));
  const tc = body.tool_choice;
  const toolChoice: CToolChoice =
    tc === "auto" || tc === "none" || tc === "required" ? tc : isObj(tc) && isObj(tc.function) && str(tc.function.name) ? { name: str(tc.function.name)! } : null;
  const extra: Json = {};
  for (const [k, v] of Object.entries(body)) if (!KNOWN.has(k)) extra[k] = v;
  const stop = typeof body.stop === "string" ? [body.stop] : Array.isArray(body.stop) ? body.stop.filter((s): s is string => typeof s === "string") : undefined;
  return {
    model: str(body.model) ?? "",
    messages,
    tools,
    toolChoice,
    stream: body.stream === true,
    temperature: num(body.temperature),
    topP: num(body.top_p),
    stop,
    reasoning: str(body.reasoning_effort) ? { effort: str(body.reasoning_effort) } : null,
    responseFormat: body.response_format,
    extra,
    capsStripped: CHAT_CAP_KEYS.filter((k) => k in body),
  };
};

export interface Passthrough {
  body: Json;
  capsStripped: string[];
  wantsUsage: boolean;
}

export const preparePassthrough = (body: Json, served: string): Passthrough => {
  if ((num(body.n) ?? 1) > 1) throw new DialectError(400, "INVALID_REQUEST", "n > 1 is not supported");
  const out: Json = { ...body };
  const capsStripped: string[] = [];
  for (const k of CHAT_CAP_KEYS)
    if (k in out) {
      delete out[k];
      capsStripped.push(k);
    }
  if (isObj(out.chat_template_kwargs) && "thinking_budget" in out.chat_template_kwargs) {
    const { thinking_budget: _drop, ...rest } = out.chat_template_kwargs;
    out.chat_template_kwargs = rest;
    capsStripped.push("chat_template_kwargs.thinking_budget");
  }
  const so = isObj(body.stream_options) ? body.stream_options : {};
  const wantsUsage = body.stream === true && so.include_usage === true;
  if ("tool_choice" in out && !(Array.isArray(out.tools) && out.tools.length)) delete out.tool_choice;
  out.model = served;
  out.stream = true;
  out.stream_options = { ...so, include_usage: true };
  return { body: out, capsStripped, wantsUsage };
};

const FINISH: Record<string, CFinish> = { stop: "stop", tool_calls: "tool_calls", function_call: "tool_calls", length: "length", content_filter: "content_filter" };

export class ChatUpstreamDecoder {
  reasoningField: "reasoning_content" | "reasoning" | null = null;
  private started = false;
  private tools = new Map<number, string>();
  private lastUsage: unknown = null;

  decode(chunk: Json): CEvent[] {
    const out: CEvent[] = [];
    if (isObj(chunk.error)) {
      const status = num(chunk.error.code) ?? null;
      out.push({ t: "error", status, code: "SERVER", message: str(chunk.error.message) ?? JSON.stringify(chunk.error) });
      return out;
    }
    if (!this.started) {
      this.started = true;
      out.push({ t: "start", id: str(chunk.id) ?? newId("chatcmpl-"), model: str(chunk.model) ?? "" });
    }
    for (const c of arr(chunk.choices)) {
      if (!isObj(c)) continue;
      const d = isObj(c.delta) ? c.delta : isObj(c.message) ? c.message : {};
      const r = str(d.reasoning_content) ?? str(d.reasoning);
      if (r) {
        this.reasoningField ??= typeof d.reasoning_content === "string" ? "reasoning_content" : "reasoning";
        out.push({ t: "reasoning", delta: r });
      }
      const text = str(d.content);
      if (text) out.push({ t: "text", delta: text });
      for (const tc of arr(d.tool_calls)) {
        if (!isObj(tc)) continue;
        const index = num(tc.index) ?? 0;
        const f = isObj(tc.function) ? tc.function : {};
        if (!this.tools.has(index)) {
          const id = str(tc.id) ?? newId("call_");
          this.tools.set(index, id);
          out.push({ t: "tool_start", index, id, name: str(f.name) ?? "" });
        }
        const a = str(f.arguments);
        if (a) out.push({ t: "tool_args", index, delta: a });
      }
      const fr = str(c.finish_reason);
      if (fr) out.push({ t: "finish", reason: FINISH[fr] ?? "stop" });
    }
    if (isObj(chunk.usage)) {
      this.lastUsage = chunk.usage;
      const b = bucketsFromOpenAiUsage(chunk.usage);
      out.push({ t: "usage", usage: b, raw: chunk.usage });
    }
    return out;
  }

  cachedReported(): boolean {
    return isObj(this.lastUsage) && bucketsFromOpenAiUsage(this.lastUsage).cachedReported;
  }
}

export const isUsageOnlyChunk = (chunk: Json): boolean => isObj(chunk.usage) && arr(chunk.choices).length === 0;

export const cacheKnownOf = (b: TokenBuckets): boolean => !("cacheSource" in b) || (b as { cacheSource: unknown }).cacheSource !== null;

export const openAiUsage = (b: TokenBuckets) => ({
  prompt_tokens: promptTotal(b),
  completion_tokens: b.output,
  total_tokens: promptTotal(b) + b.output,
  ...(cacheKnownOf(b) ? { prompt_tokens_details: { cached_tokens: b.cacheRead } } : {}),
  completion_tokens_details: { reasoning_tokens: b.reasoning },
});

export const patchUsageChunk = (chunk: Json, b: TokenBuckets): Json => {
  const u = isObj(chunk.usage) ? chunk.usage : {};
  const details = isObj(u.prompt_tokens_details) ? u.prompt_tokens_details : {};
  return { ...chunk, usage: { ...u, prompt_tokens_details: { ...details, cached_tokens: b.cacheRead } } };
};

export class ChatAggregator {
  private id = newId("chatcmpl-");
  private model = "";
  private text = "";
  private reasoning = "";
  private tools: { id: string; name: string; args: string }[] = [];
  private toolAt = new Map<number, number>();

  constructor(private reasoningField: () => string | null) {}

  onEvent(e: CEvent): void {
    if (e.t === "start") {
      this.id = e.id;
      this.model = e.model;
    } else if (e.t === "text") this.text += e.delta;
    else if (e.t === "reasoning") this.reasoning += e.delta;
    else if (e.t === "tool_start") {
      this.toolAt.set(e.index, this.tools.length);
      this.tools.push({ id: e.id, name: e.name, args: "" });
    } else if (e.t === "tool_args") {
      const i = this.toolAt.get(e.index);
      const t = i === undefined ? undefined : this.tools[i];
      if (t) t.args += e.delta;
    }
  }

  result(usage: TokenBuckets | null, reason: CFinish | null, rawUsage: unknown): Json {
    const message: Json = { role: "assistant", content: this.text || null };
    if (this.reasoning) message[this.reasoningField() ?? "reasoning_content"] = this.reasoning;
    if (this.tools.length) message.tool_calls = this.tools.map((t) => ({ id: t.id, type: "function", function: { name: t.name, arguments: t.args } }));
    const u: Json | null = usage ? { ...(isObj(rawUsage) ? rawUsage : {}), ...openAiUsage(usage) } : null;
    if (u && usage && !cacheKnownOf(usage) && isObj(u.prompt_tokens_details)) {
      const { cached_tokens: _c, ...rest } = u.prompt_tokens_details;
      u.prompt_tokens_details = Object.keys(rest).length ? rest : undefined;
    }
    return {
      id: this.id,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: this.model,
      choices: [{ index: 0, message, finish_reason: reason ?? (this.tools.length ? "tool_calls" : "stop") }],
      usage: u,
    };
  }
}

export const chatErrorBody = (code: ErrorCode, message: string) => ({ error: openAiError(code, message) });

export const chatErrorFrame = (code: ErrorCode, message: string): string => `data: ${JSON.stringify(chatErrorBody(code, message))}\n\ndata: [DONE]\n\n`;
