import type { ErrorCode, TokenBuckets } from "@local-studio/contracts";

export type CPart = { type: "text"; text: string } | { type: "image"; url: string };

export interface CToolCall {
  id: string;
  name: string;
  args: string;
}

export type CMessage =
  | { role: "system"; text: string }
  | { role: "user"; parts: CPart[] }
  | { role: "assistant"; text: string; reasoning: string | null; toolCalls: CToolCall[] }
  | { role: "tool"; toolCallId: string; parts: CPart[]; isError: boolean };

export interface CTool {
  name: string;
  description?: string;
  parameters: unknown;
  strict?: boolean;
}

export type CToolChoice = "auto" | "none" | "required" | { name: string } | null;

export interface CRequest {
  model: string;
  messages: CMessage[];
  tools: CTool[];
  toolChoice: CToolChoice;
  stream: boolean;
  temperature?: number;
  topP?: number;
  stop?: string[];
  reasoning: { effort?: string; enabled?: boolean } | null;
  responseFormat?: unknown;
  extra: Record<string, unknown>;
  capsStripped: string[];
}

export type CFinish = "stop" | "tool_calls" | "length" | "content_filter";

export type CEvent =
  | { t: "start"; id: string; model: string }
  | { t: "text"; delta: string }
  | { t: "reasoning"; delta: string }
  | { t: "tool_start"; index: number; id: string; name: string }
  | { t: "tool_args"; index: number; delta: string }
  | { t: "usage"; usage: TokenBuckets; raw: unknown }
  | { t: "finish"; reason: CFinish }
  | { t: "error"; status: number | null; code: ErrorCode; message: string };

export class DialectError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export type Json = Record<string, unknown>;

export const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
export const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
export const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

let counter = 0;
export const newId = (prefix: string): string => `${prefix}${Date.now().toString(36)}${(counter++ % 1296).toString(36).padStart(2, "0")}${Math.random().toString(36).slice(2, 8)}`;

export const partsText = (parts: CPart[]): string =>
  parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("\n");

export interface SseEvent {
  event: string | null;
  data: string;
  raw: string;
}

export class SseParser {
  private buf = "";

  push(text: string): SseEvent[] {
    this.buf += text;
    const out: SseEvent[] = [];
    for (;;) {
      const m = /\r?\n\r?\n/.exec(this.buf);
      if (!m) break;
      const raw = this.buf.slice(0, m.index);
      this.buf = this.buf.slice(m.index + m[0].length);
      const ev = parseBlock(raw);
      if (ev) out.push(ev);
    }
    return out;
  }

  flush(): SseEvent[] {
    const rest = this.buf.trim();
    this.buf = "";
    const ev = rest ? parseBlock(rest) : null;
    return ev ? [ev] : [];
  }
}

const parseBlock = (raw: string): SseEvent | null => {
  let event: string | null = null;
  const data: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  if (!data.length && event === null) return null;
  return { event, data: data.join("\n"), raw };
};

export const sseFrame = (event: string | null, data: unknown): string =>
  `${event ? `event: ${event}\n` : ""}data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`;

export interface Encoder {
  onEvent(e: CEvent): string;
  finish(usage: TokenBuckets | null, reason: CFinish | null): string;
  fail(code: ErrorCode, message: string): string;
  result(): unknown;
}

export const isContentEvent = (e: CEvent): boolean =>
  (e.t === "text" && e.delta.length > 0) ||
  (e.t === "reasoning" && e.delta.length > 0) ||
  e.t === "tool_start" ||
  (e.t === "tool_args" && e.delta.length > 0);

export const estimateTokens = (req: CRequest): number => {
  const t = (s: string) => Math.ceil(s.length / 4) + 4;
  let n = 0;
  for (const m of req.messages) {
    if (m.role === "system") n += t(m.text);
    else if (m.role === "assistant") {
      n += m.text ? t(m.text) : 0;
      n += m.reasoning ? t(m.reasoning) : 0;
      for (const c of m.toolCalls) n += Math.ceil(c.name.length / 4) + Math.ceil(c.args.length / 4) + 4;
    } else for (const p of m.parts) n += p.type === "text" ? t(p.text) : 4 + Math.ceil(p.url.length / 4);
    n += 4;
  }
  if (req.tools.length) n += Math.ceil(JSON.stringify(req.tools).length / 4) + 4;
  return n;
};

const OPENAI_CODE: Record<ErrorCode, string> = {
  AUTH: "invalid_api_key",
  QUOTA: "insufficient_quota",
  RATE_LIMIT: "rate_limit_exceeded",
  INVALID_REQUEST: "invalid_request_error",
  MODEL_NOT_FOUND: "model_not_found",
  CONTEXT_WINDOW_EXCEEDED: "context_length_exceeded",
  SERVER: "server_error",
  TIMEOUT: "timeout",
  TRANSPORT: "server_error",
  EMPTY_RESPONSE: "server_error",
  ABORTED: "client_closed_request",
  UNKNOWN: "server_error",
};

const OPENAI_TYPE: Partial<Record<ErrorCode, string>> = {
  AUTH: "authentication_error",
  QUOTA: "insufficient_quota",
  RATE_LIMIT: "rate_limit_error",
  INVALID_REQUEST: "invalid_request_error",
  MODEL_NOT_FOUND: "invalid_request_error",
  CONTEXT_WINDOW_EXCEEDED: "invalid_request_error",
};

export const openAiError = (code: ErrorCode, message: string) => ({
  message,
  type: OPENAI_TYPE[code] ?? "server_error",
  code: OPENAI_CODE[code],
  param: null,
  local_studio_code: code,
});

const firstInt = (text: string, res: RegExp[]): number | null => {
  for (const re of res) {
    const m = re.exec(text);
    if (m?.[1]) return Number(m[1]);
  }
  return null;
};

export const promptTooLong = (message: string): string => {
  const max = firstInt(message, [/maximum context length is (\d+)/i, /context size \((\d+)/i, /context (?:window|length) (?:of|is) (\d+)/i, /context length \((\d+)/i, /> ?(\d+) maximum/i]);
  const asked = firstInt(message, [/requested (\d+)/i, /request \((\d+) tokens\)/i, /(?:prompt|request) (?:has|contains|is) (\d+)/i, /input \((\d+) tokens\)/i, /passed (\d+)/i, /(\d+) input tokens/i, /you have (\d+)/i]);
  return asked !== null && max !== null ? `prompt is too long: ${asked} tokens > ${max} maximum (${message})` : `prompt is too long: ${message}`;
};
