import type { ErrorCode, TokenBuckets } from "@local-studio/contracts";
import { promptTotal } from "@local-studio/contracts";
import type { CEvent, CFinish, CMessage, CPart, CRequest, CTool, CToolChoice, Encoder, Json } from "../canonical";
import { DialectError, arr, isObj, newId, num, openAiError, sseFrame, str } from "../canonical";
import { cacheKnownOf } from "./chat";

const CAPS = ["max_output_tokens", "max_tokens", "max_completion_tokens"];
const KNOWN = new Set([
  "model", "input", "instructions", "tools", "tool_choice", "stream", "temperature", "top_p", "reasoning", "text", "store", "include",
  "metadata", "previous_response_id", "parallel_tool_calls", "prompt_cache_key", "service_tier", "user", "truncation", "background", ...CAPS,
]);

const CUSTOM_PARAMS = { type: "object", properties: { input: { type: "string" } }, required: ["input"] };

const parts = (c: unknown): CPart[] => {
  if (typeof c === "string") return [{ type: "text", text: c }];
  const out: CPart[] = [];
  for (const p of arr(c)) {
    if (!isObj(p)) continue;
    if ((p.type === "input_text" || p.type === "output_text" || p.type === "text") && typeof p.text === "string") out.push({ type: "text", text: p.text });
    else if (p.type === "input_image") {
      const url = str(p.image_url) ?? (isObj(p.image_url) ? str(p.image_url.url) : undefined);
      if (url) out.push({ type: "image", url });
    }
  }
  return out;
};

const text = (c: unknown): string =>
  parts(c)
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("");

export interface ResponsesDecoded {
  req: CRequest;
  customTools: Set<string>;
}

export const decodeResponsesRequest = (body: Json): ResponsesDecoded => {
  if (body.previous_response_id) throw new DialectError(400, "INVALID_REQUEST", "previous_response_id is not supported: send the full input with store:false");
  if (body.store === true) throw new DialectError(400, "INVALID_REQUEST", "store:true is not supported: this gateway keeps no response state, send store:false");
  const customTools = new Set<string>();
  const tools: CTool[] = [];
  for (const t of arr(body.tools)) {
    if (!isObj(t)) continue;
    if (t.type === "function") tools.push({ name: str(t.name) ?? "", description: str(t.description), parameters: t.parameters ?? {}, strict: typeof t.strict === "boolean" ? t.strict : undefined });
    else if (t.type === "custom" && str(t.name)) {
      customTools.add(str(t.name)!);
      tools.push({ name: str(t.name)!, description: str(t.description), parameters: CUSTOM_PARAMS });
    }
  }
  const messages: CMessage[] = [];
  if (str(body.instructions)) messages.push({ role: "system", text: str(body.instructions)! });
  let pendingReasoning: string | null = null;
  const lastAssistant = (): Extract<CMessage, { role: "assistant" }> => {
    const last = messages[messages.length - 1];
    if (last?.role === "assistant") return last;
    const m: Extract<CMessage, { role: "assistant" }> = { role: "assistant", text: "", reasoning: pendingReasoning, toolCalls: [] };
    pendingReasoning = null;
    messages.push(m);
    return m;
  };
  const input = typeof body.input === "string" ? [{ type: "message", role: "user", content: body.input }] : arr(body.input);
  for (const it of input) {
    if (!isObj(it)) continue;
    const type = str(it.type) ?? (it.role ? "message" : "");
    if (type === "message") {
      const role = str(it.role);
      if (role === "system" || role === "developer") messages.push({ role: "system", text: text(it.content) });
      else if (role === "assistant") {
        const a = lastAssistant();
        a.text += text(it.content);
      } else messages.push({ role: "user", parts: parts(it.content) });
    } else if (type === "function_call" || type === "custom_tool_call") {
      const args = type === "custom_tool_call" ? JSON.stringify({ input: str(it.input) ?? "" }) : str(it.arguments) ?? "";
      lastAssistant().toolCalls.push({ id: str(it.call_id) ?? str(it.id) ?? newId("call_"), name: str(it.name) ?? "", args });
    } else if (type === "function_call_output" || type === "custom_tool_call_output") {
      const out = it.output;
      messages.push({ role: "tool", toolCallId: str(it.call_id) ?? "", parts: typeof out === "string" ? [{ type: "text", text: out }] : parts(out), isError: false });
    } else if (type === "reasoning") {
      const r = [...arr(it.summary), ...arr(it.content)]
        .filter(isObj)
        .map((s) => str(s.text) ?? "")
        .join("\n");
      if (r) pendingReasoning = pendingReasoning ? `${pendingReasoning}\n${r}` : r;
    }
  }
  const tc = body.tool_choice;
  const toolChoice: CToolChoice = tc === "auto" || tc === "none" || tc === "required" ? tc : isObj(tc) && str(tc.name) ? { name: str(tc.name)! } : null;
  const fmt = isObj(body.text) && isObj(body.text.format) ? body.text.format : null;
  const responseFormat =
    fmt?.type === "json_schema"
      ? { type: "json_schema", json_schema: { name: str(fmt.name) ?? "response", schema: fmt.schema ?? {}, strict: fmt.strict === true } }
      : fmt?.type === "json_object"
        ? { type: "json_object" }
        : undefined;
  const extra: Json = {};
  for (const [k, v] of Object.entries(body)) if (!KNOWN.has(k)) extra[k] = v;
  if (typeof body.parallel_tool_calls === "boolean") extra.parallel_tool_calls = body.parallel_tool_calls;
  const effort = isObj(body.reasoning) ? str(body.reasoning.effort) : undefined;
  return {
    customTools,
    req: {
      model: str(body.model) ?? "",
      messages,
      tools,
      toolChoice,
      stream: body.stream === true,
      temperature: num(body.temperature),
      topP: num(body.top_p),
      reasoning: effort ? { effort } : null,
      responseFormat,
      extra,
      capsStripped: CAPS.filter((k) => k in body),
    },
  };
};

type Item = Json & { id: string; type: string };

export const responsesUsage = (b: TokenBuckets) => ({
  input_tokens: promptTotal(b),
  ...(cacheKnownOf(b) ? { input_tokens_details: { cached_tokens: b.cacheRead } } : {}),
  output_tokens: b.output,
  output_tokens_details: { reasoning_tokens: b.reasoning },
  total_tokens: promptTotal(b) + b.output,
});

export class ResponsesEncoder implements Encoder {
  private seq = 0;
  private id = newId("resp_");
  private created = Math.floor(Date.now() / 1000);
  private items: Item[] = [];
  private open: { item: Item; kind: "message" | "reasoning"; index: number; buf: string } | null = null;
  private tools = new Map<number, { item: Item; index: number; buf: string; open: boolean }>();
  private final: Json | null = null;
  private began = false;

  constructor(
    private model: string,
    private customTools: Set<string>,
  ) {}

  private ev(type: string, data: Json): string {
    return sseFrame(type, { type, sequence_number: this.seq++, ...data });
  }

  private response(status: string, extra: Json = {}): Json {
    return { id: this.id, object: "response", created_at: this.created, status, model: this.model, output: this.items, parallel_tool_calls: true, tool_choice: "auto", tools: [], ...extra };
  }

  begin(): string {
    if (this.began) return "";
    this.began = true;
    return this.ev("response.created", { response: this.response("in_progress", { output: [] }) }) + this.ev("response.in_progress", { response: this.response("in_progress", { output: [] }) });
  }

  private close(): string {
    const o = this.open;
    if (!o) return "";
    this.open = null;
    const base = { item_id: o.item.id, output_index: o.index };
    let s = "";
    if (o.kind === "message") {
      const part = { type: "output_text", text: o.buf, annotations: [] };
      s += this.ev("response.output_text.done", { ...base, content_index: 0, text: o.buf });
      s += this.ev("response.content_part.done", { ...base, content_index: 0, part });
      Object.assign(o.item, { status: "completed", content: [part] });
    } else {
      const part = { type: "summary_text", text: o.buf };
      s += this.ev("response.reasoning_summary_text.done", { ...base, summary_index: 0, text: o.buf });
      s += this.ev("response.reasoning_summary_part.done", { ...base, summary_index: 0, part });
      Object.assign(o.item, { summary: [part] });
    }
    return s + this.ev("response.output_item.done", { output_index: o.index, item: o.item });
  }

  private settleTool(t: { item: Item; buf: string }): void {
    if (t.item.type === "custom_tool_call") {
      let input = t.buf;
      try {
        const p = JSON.parse(t.buf) as unknown;
        if (isObj(p) && typeof p.input === "string") input = p.input;
      } catch {}
      Object.assign(t.item, { status: "completed", input });
    } else Object.assign(t.item, { status: "completed", arguments: t.buf });
  }

  private closeTools(): string {
    let s = "";
    for (const t of this.tools.values()) {
      if (!t.open) continue;
      t.open = false;
      this.settleTool(t);
      if (t.item.type === "function_call") s += this.ev("response.function_call_arguments.done", { item_id: t.item.id, output_index: t.index, arguments: t.buf });
      s += this.ev("response.output_item.done", { output_index: t.index, item: t.item });
    }
    return s;
  }

  private added(item: Item): { s: string; index: number } {
    const index = this.items.length;
    this.items.push(item);
    return { s: this.ev("response.output_item.added", { output_index: index, item: { ...item } }), index };
  }

  onEvent(e: CEvent): string {
    let s = this.begin();
    if ((e.t === "text" || e.t === "reasoning") && e.delta) {
      const kind = e.t === "text" ? "message" : "reasoning";
      if (this.open?.kind !== kind) {
        s += this.close() + this.closeTools();
        const item: Item = kind === "message" ? { id: newId("msg_"), type: "message", role: "assistant", status: "in_progress", content: [] } : { id: newId("rs_"), type: "reasoning", summary: [] };
        const a = this.added(item);
        s += a.s;
        this.open = { item, kind, index: a.index, buf: "" };
        const base = { item_id: item.id, output_index: a.index };
        if (kind === "message") s += this.ev("response.content_part.added", { ...base, content_index: 0, part: { type: "output_text", text: "", annotations: [] } });
        else s += this.ev("response.reasoning_summary_part.added", { ...base, summary_index: 0, part: { type: "summary_text", text: "" } });
      }
      const o = this.open!;
      o.buf += e.delta;
      if (kind === "message") s += this.ev("response.output_text.delta", { item_id: o.item.id, output_index: o.index, content_index: 0, delta: e.delta });
      else s += this.ev("response.reasoning_summary_text.delta", { item_id: o.item.id, output_index: o.index, summary_index: 0, delta: e.delta });
    } else if (e.t === "tool_start") {
      s += this.close();
      const custom = this.customTools.has(e.name);
      const item: Item = custom
        ? { id: newId("ctc_"), type: "custom_tool_call", status: "in_progress", call_id: e.id, name: e.name, input: "" }
        : { id: newId("fc_"), type: "function_call", status: "in_progress", call_id: e.id, name: e.name, arguments: "" };
      const a = this.added(item);
      s += a.s;
      this.tools.set(e.index, { item, index: a.index, buf: "", open: true });
    } else if (e.t === "tool_args" && e.delta) {
      const t = this.tools.get(e.index);
      if (t) {
        t.buf += e.delta;
        if (!t.open) this.settleTool(t);
        else if (t.item.type === "function_call") s += this.ev("response.function_call_arguments.delta", { item_id: t.item.id, output_index: t.index, delta: e.delta });
      }
    }
    return s;
  }

  finish(usage: TokenBuckets | null, reason: CFinish | null): string {
    let s = this.begin() + this.close() + this.closeTools();
    const incomplete = reason === "length" || reason === "content_filter";
    this.final = this.response(incomplete ? "incomplete" : "completed", {
      incomplete_details: incomplete ? { reason: reason === "length" ? "max_output_tokens" : "content_filter" } : null,
      usage: usage ? responsesUsage(usage) : null,
    });
    s += this.ev(incomplete ? "response.incomplete" : "response.completed", { response: this.final });
    return s;
  }

  fail(code: ErrorCode, message: string): string {
    let s = this.begin() + this.close() + this.closeTools();
    const { code: oc, message: om, local_studio_code } = openAiError(code, message);
    this.final = this.response("failed", { error: { code: oc, message: om, local_studio_code } });
    s += this.ev("response.failed", { response: this.final });
    return s;
  }

  result(): unknown {
    return this.final;
  }
}

export const responsesErrorBody = (code: ErrorCode, message: string) => ({ error: openAiError(code, message) });
