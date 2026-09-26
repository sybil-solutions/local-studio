import type { ErrorCode, TokenBuckets } from "@local-studio/contracts";
import type { CEvent, CFinish, CMessage, CPart, CRequest, CTool, CToolChoice, Encoder, Json } from "../canonical";
import { arr, isObj, newId, num, promptTooLong, sseFrame, str } from "../canonical";

const KNOWN = new Set([
  "model", "messages", "system", "tools", "tool_choice", "stream", "temperature", "top_p", "top_k", "stop_sequences", "thinking",
  "max_tokens", "metadata", "service_tier", "container", "mcp_servers", "context_management",
]);

const blockParts = (c: unknown): CPart[] => {
  if (typeof c === "string") return [{ type: "text", text: c }];
  const out: CPart[] = [];
  for (const b of arr(c)) {
    if (!isObj(b)) continue;
    if (b.type === "text" && typeof b.text === "string") out.push({ type: "text", text: b.text });
    else if (b.type === "image" && isObj(b.source)) {
      const s = b.source;
      if (s.type === "base64" && str(s.data)) out.push({ type: "image", url: `data:${str(s.media_type) ?? "image/png"};base64,${str(s.data)}` });
      else if (s.type === "url" && str(s.url)) out.push({ type: "image", url: str(s.url)! });
    }
  }
  return out;
};

export const decodeMessagesRequest = (body: Json): CRequest => {
  const messages: CMessage[] = [];
  const sys = typeof body.system === "string" ? body.system : blockParts(body.system).map((p) => (p.type === "text" ? p.text : "")).join("\n");
  if (sys) messages.push({ role: "system", text: sys });
  for (const m of arr(body.messages)) {
    if (!isObj(m)) continue;
    const blocks = typeof m.content === "string" ? [{ type: "text", text: m.content }] : arr(m.content).filter(isObj);
    if (m.role === "assistant") {
      const a: Extract<CMessage, { role: "assistant" }> = { role: "assistant", text: "", reasoning: null, toolCalls: [] };
      for (const b of blocks) {
        if (b.type === "text") a.text += str(b.text) ?? "";
        else if (b.type === "thinking") a.reasoning = (a.reasoning ?? "") + (str(b.thinking) ?? "");
        else if (b.type === "tool_use") a.toolCalls.push({ id: str(b.id) ?? newId("toolu_"), name: str(b.name) ?? "", args: JSON.stringify(b.input ?? {}) });
      }
      messages.push(a);
      continue;
    }
    const userParts: CPart[] = [];
    for (const b of blocks) {
      if (b.type === "tool_result")
        messages.push({ role: "tool", toolCallId: str(b.tool_use_id) ?? "", parts: blockParts(b.content ?? ""), isError: b.is_error === true });
      else userParts.push(...blockParts([b]));
    }
    if (userParts.length) messages.push({ role: "user", parts: userParts });
  }
  const tools: CTool[] = arr(body.tools)
    .filter(isObj)
    .filter((t) => t.type === undefined || t.type === "custom" || isObj(t.input_schema))
    .map((t) => ({ name: str(t.name) ?? "", description: str(t.description), parameters: t.input_schema ?? { type: "object", properties: {} } }));
  const tc = isObj(body.tool_choice) ? body.tool_choice : null;
  const toolChoice: CToolChoice =
    tc?.type === "auto" ? "auto" : tc?.type === "any" ? "required" : tc?.type === "none" ? "none" : tc?.type === "tool" && str(tc.name) ? { name: str(tc.name)! } : null;
  const capsStripped: string[] = [];
  if ("max_tokens" in body) capsStripped.push("max_tokens");
  const th = isObj(body.thinking) ? body.thinking : null;
  if (th && "budget_tokens" in th) capsStripped.push("thinking.budget_tokens");
  const extra: Json = {};
  for (const [k, v] of Object.entries(body)) if (!KNOWN.has(k)) extra[k] = v;
  if (num(body.top_k) !== undefined) extra.top_k = body.top_k;
  return {
    model: str(body.model) ?? "",
    messages,
    tools,
    toolChoice,
    stream: body.stream === true,
    temperature: num(body.temperature),
    topP: num(body.top_p),
    stop: arr(body.stop_sequences).filter((s): s is string => typeof s === "string"),
    reasoning: th ? { enabled: th.type !== "disabled" } : null,
    extra,
    capsStripped,
  };
};

const STOP: Record<CFinish, string> = { stop: "end_turn", tool_calls: "tool_use", length: "max_tokens", content_filter: "refusal" };

export const anthropicUsage = (b: TokenBuckets) => ({
  input_tokens: b.inputUncached,
  cache_read_input_tokens: b.cacheRead,
  cache_creation_input_tokens: b.cacheWrite,
  output_tokens: b.output,
});

type Block = Json & { type: string };

interface ToolBlock {
  index: number;
  buf: string;
  open: boolean;
}

export class MessagesEncoder implements Encoder {
  private id = newId("msg_");
  private blocks: Block[] = [];
  private open: { kind: "text" | "thinking"; index: number } | null = null;
  private tools = new Map<number, ToolBlock>();
  private began = false;
  private final: Json | null = null;
  private sawTool = false;

  constructor(private model: string) {}

  begin(): string {
    if (this.began) return "";
    this.began = true;
    return sseFrame("message_start", {
      type: "message_start",
      message: { id: this.id, type: "message", role: "assistant", model: this.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } },
    });
  }

  private stop(index: number): string {
    return sseFrame("content_block_stop", { type: "content_block_stop", index });
  }

  private closeText(): string {
    const o = this.open;
    if (!o) return "";
    this.open = null;
    return this.stop(o.index);
  }

  private settleInput(t: ToolBlock): void {
    const b = this.blocks[t.index];
    if (!b) return;
    try {
      b.input = t.buf ? (JSON.parse(t.buf) as unknown) : {};
    } catch {
      b.input = { _raw: t.buf };
    }
  }

  private closeTools(): string {
    let s = "";
    for (const t of this.tools.values()) {
      if (!t.open) continue;
      t.open = false;
      this.settleInput(t);
      s += this.stop(t.index);
    }
    return s;
  }

  private push(block: Block): number {
    this.blocks.push(block);
    return this.blocks.length - 1;
  }

  onEvent(e: CEvent): string {
    let s = this.begin();
    const delta = (index: number, d: Json) => sseFrame("content_block_delta", { type: "content_block_delta", index, delta: d });
    if ((e.t === "text" || e.t === "reasoning") && e.delta) {
      const kind = e.t === "text" ? "text" : "thinking";
      if (this.open?.kind !== kind) {
        s += this.closeText() + this.closeTools();
        const block: Block = kind === "text" ? { type: "text", text: "" } : { type: "thinking", thinking: "", signature: "" };
        const index = this.push(block);
        this.open = { kind, index };
        s += sseFrame("content_block_start", { type: "content_block_start", index, content_block: { ...block } });
      }
      const b = this.blocks[this.open!.index] as Json;
      if (kind === "text") {
        b.text += e.delta;
        s += delta(this.open!.index, { type: "text_delta", text: e.delta });
      } else {
        b.thinking += e.delta;
        s += delta(this.open!.index, { type: "thinking_delta", thinking: e.delta });
      }
    } else if (e.t === "tool_start") {
      this.sawTool = true;
      s += this.closeText();
      const block: Block = { type: "tool_use", id: e.id, name: e.name, input: {} };
      const index = this.push(block);
      this.tools.set(e.index, { index, buf: "", open: true });
      s += sseFrame("content_block_start", { type: "content_block_start", index, content_block: { ...block, input: {} } });
    } else if (e.t === "tool_args" && e.delta) {
      const t = this.tools.get(e.index);
      if (t) {
        t.buf += e.delta;
        if (t.open) s += delta(t.index, { type: "input_json_delta", partial_json: e.delta });
        else this.settleInput(t);
      }
    }
    return s;
  }

  finish(usage: TokenBuckets | null, reason: CFinish | null): string {
    let s = this.begin() + this.closeText() + this.closeTools();
    const stop = STOP[reason ?? (this.sawTool ? "tool_calls" : "stop")];
    const u = usage ? anthropicUsage(usage) : { input_tokens: 0, output_tokens: 0 };
    this.final = { id: this.id, type: "message", role: "assistant", model: this.model, content: this.blocks, stop_reason: stop, stop_sequence: null, usage: u };
    s += sseFrame("message_delta", { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: u });
    s += sseFrame("message_stop", { type: "message_stop" });
    return s;
  }

  fail(code: ErrorCode, message: string): string {
    this.final = null;
    return this.begin() + this.closeText() + this.closeTools() + sseFrame("error", messagesErrorBody(code, message));
  }

  result(): unknown {
    return this.final;
  }
}

const ANTHROPIC_TYPE: Partial<Record<ErrorCode, string>> = {
  AUTH: "authentication_error",
  QUOTA: "billing_error",
  INVALID_REQUEST: "invalid_request_error",
  CONTEXT_WINDOW_EXCEEDED: "invalid_request_error",
  MODEL_NOT_FOUND: "not_found_error",
  RATE_LIMIT: "rate_limit_error",
  TIMEOUT: "timeout_error",
};

export const messagesErrorBody = (code: ErrorCode, message: string, status?: number) => ({
  type: "error",
  error: {
    type: status === 503 || status === 529 ? "overloaded_error" : ANTHROPIC_TYPE[code] ?? "api_error",
    message: code === "CONTEXT_WINDOW_EXCEEDED" ? promptTooLong(message) : message,
    local_studio_code: code,
  },
});
