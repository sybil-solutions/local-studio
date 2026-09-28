import { type Gate, GATES, MIN_TPS } from "@local-studio/registry";

export { type Gate, GATES, MIN_TPS };

export interface Target {
  endpoint: string;
  ctx: number;
  key?: string;
  onGate?: (gate: Gate, ok: boolean) => void;
}

export interface GateProof {
  gates: string;
  tps: number;
  prefill: number | null;
  served: string;
}

export interface GateRun {
  passed: boolean;
  proof: GateProof;
  evidence: { ok: Partial<Record<Gate, boolean>> } & Record<string, unknown>;
}

type Msg = Record<string, unknown>;
type Choice = { message: Msg & { content?: string | null; reasoning_content?: string | null; reasoning?: string | null; tool_calls?: ToolCall[] }; finish_reason?: string };
type ToolCall = { id?: string; function: { name: string; arguments: string } };
type Usage = { prompt_tokens?: number; completion_tokens?: number; counted?: string; peak_memory_gb?: number };

const headers = (t: Target): Record<string, string> => ({ "content-type": "application/json", ...(t.key ? { authorization: `Bearer ${t.key}` } : {}) });

const call = async <T>(t: Target, path: string, body?: unknown, timeoutMs?: number): Promise<{ out: T; secs: number }> => {
  const t0 = performance.now();
  const res = await fetch(t.endpoint + path, {
    method: body === undefined ? "GET" : "POST",
    headers: headers(t),
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return { out: (await res.json()) as T, secs: (performance.now() - t0) / 1000 };
};

export const count = async (t: Target, text: string): Promise<[number, "tokenizer" | "estimate"]> => {
  const tries: [string, Record<string, string>][] = [
    ["/v1/token/encode", { text }],
    ["/tokenize", { prompt: text }],
    ["/v1/tokenize", { prompt: text }],
    ["/tokenize", { content: text }],
  ];
  for (const [path, body] of tries) {
    try {
      const { out } = await call<{ length?: number; count?: number; tokens?: unknown[] }>(t, path, body, 120_000);
      const n = Number(out.length || out.count || (out.tokens ?? []).length);
      if (n || !text) return [n, "tokenizer"];
    } catch {}
  }
  return [Math.floor(text.length / 4), "estimate"];
};

const thinking = (m: Choice["message"]): string => m.reasoning_content || m.reasoning || "";

const chat = async (t: Target, model: string, messages: Msg[], extra: Record<string, unknown> = {}): Promise<{ c: Choice; u: Usage; secs: number }> => {
  const { out, secs } = await call<{ choices: Choice[]; usage?: Usage; timings?: { peak_memory?: number } }>(t, "/v1/chat/completions", { model, messages, temperature: 0.6, ...extra });
  const c = out.choices[0]!;
  const u: Usage = { ...(out.usage ?? {}) };
  if (out.timings?.peak_memory) u.peak_memory_gb = out.timings.peak_memory;
  if (!u.prompt_tokens) [u.prompt_tokens, u.counted] = await count(t, messages.map((m) => (m.content as string) || "").join("\n"));
  if (!u.completion_tokens) [u.completion_tokens, u.counted] = await count(t, thinking(c.message) + (c.message.content || ""));
  return { c, u, secs };
};

const streamRate = async (t: Target, model: string, prompt: string, window = 30): Promise<{ tps: number; total: number; secs: number }> => {
  const t0 = performance.now() / 1000;
  const res = await fetch(`${t.endpoint}/v1/chat/completions`, {
    method: "POST",
    headers: headers(t),
    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], temperature: 0.8, stream: true }),
  });
  if (!res.ok || !res.body) throw new Error(`stream: HTTP ${res.status}`);
  const text: string[] = [];
  let first: number | null = null;
  let atWindow: [string, number] | null = null;
  let buf = "";
  const dec = new TextDecoder();
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:") || line === "data: [DONE]") continue;
      let d: Record<string, string | null | undefined>;
      try {
        d = (JSON.parse(line.slice(5)) as { choices: { delta: Record<string, string | null> }[] }).choices[0]!.delta;
      } catch {
        continue;
      }
      const piece = (d.reasoning_content || d.reasoning || "") + (d.content || "");
      if (!piece) continue;
      const now = performance.now() / 1000;
      first ??= now;
      text.push(piece);
      if (atWindow === null && now - first >= window) atWindow = [text.join(""), now - first];
    }
  }
  const whole = text.join("");
  const elapsed = performance.now() / 1000 - (first ?? t0);
  const [sample, span] = atWindow ?? [whole, elapsed];
  const [n] = await count(t, sample);
  const [total] = await count(t, whole);
  return { tps: span ? n / span : 0, total, secs: performance.now() / 1000 - t0 };
};

const TOOL = {
  type: "function",
  function: { name: "get_weather", description: "Current weather for a city", parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } },
};

export const runGates = async (t: Target): Promise<GateRun> => {
  const ok: Partial<Record<Gate, boolean>> = {};
  const ev: Record<string, unknown> = {};
  const mark = (g: Gate, v: boolean) => {
    ok[g] = v;
    t.onGate?.(g, v);
  };
  const { out: models } = await call<{ data: { id: string }[] }>(t, "/v1/models", undefined, 30_000);
  const served = models.data[0]!.id;
  mark("load", true);

  let r = await chat(t, served, [{ role: "user", content: "Name three primary colors, comma separated." }]);
  mark("chat", !!(r.c.message.content || "").trim() && r.c.finish_reason === "stop");
  ev.chat = { content: r.c.message.content, finish: r.c.finish_reason };

  r = await chat(t, served, [{ role: "user", content: "What is 17 * 23? Reply with only the number." }]);
  const th = thinking(r.c.message);
  const content = r.c.message.content || "";
  mark("reasoning", !!th.trim() && content.includes("391") && !content.includes("<think>"));
  ev.reasoning = { thinking_chars: th.length, content: content.slice(-200) };

  const msgs: Msg[] = [{ role: "user", content: "What's the weather in Paris right now? Use the tool." }];
  r = await chat(t, served, msgs, { tools: [TOOL] });
  const calls = r.c.message.tool_calls ?? [];
  let args: { city?: unknown } = {};
  try {
    args = calls.length ? (JSON.parse(calls[0]!.function.arguments) as { city?: unknown }) : {};
  } catch {}
  const first = calls.length > 0 && calls[0]!.function.name === "get_weather" && String(args.city ?? "").toLowerCase().includes("paris");
  let reply = "";
  let second: Record<string, unknown> = {};
  if (first) {
    msgs.push(
      { role: "assistant", content: r.c.message.content || "", tool_calls: calls },
      { role: "tool", tool_call_id: calls[0]!.id ?? "0", content: JSON.stringify({ city: "Paris", temp_c: 17, sky: "overcast" }) },
    );
    const r2 = await chat(t, served, msgs, { tools: [TOOL] });
    reply = r2.c.message.content || "";
    second = { finish: r2.c.finish_reason, calls_again: (r2.c.message.tool_calls ?? []).length, thinking_chars: thinking(r2.c.message).length };
  }
  mark("tools", first && reply.includes("17"));
  ev.tools = { call: calls.slice(0, 1), reply: reply.slice(-200), ...second };

  const target = Math.floor(t.ctx * 0.85);
  const filler = Array.from({ length: Math.floor(target / 24) }, (_, i) => `Line ${i}: the archive notes that shipment ${(i * 7) % 997} left dock ${i % 13} on schedule.`).join(" ");
  const prompt = `${filler} The access code for the vault is 58213. Anything else is routine.`;
  r = await chat(t, served, [{ role: "user", content: `${prompt}\n\nWhat is the access code for the vault? Reply with only the code.` }]);
  const got = r.u.prompt_tokens ?? 0;
  mark("context", (r.c.message.content || "").includes("58213") && got >= t.ctx * 0.6);
  const ctxEv: Record<string, unknown> = { prompt_tokens: got, seconds: Math.round(r.secs * 10) / 10, content: (r.c.message.content || "").slice(-80) };
  if (r.u.peak_memory_gb) ctxEv.peak_gib = Math.round(((r.u.peak_memory_gb * 1e9) / 2 ** 30) * 100) / 100;
  ev.context = ctxEv;

  const s = await streamRate(t, served, "Write a detailed 600-word story about a lighthouse keeper.");
  mark("speed", s.tps >= MIN_TPS);
  ev.speed = { window_s: 30, tokens_total: s.total, seconds_total: Math.round(s.secs * 10) / 10 };
  const secs = ctxEv.seconds as number;
  const proof: GateProof = { gates: GATES.filter((g) => ok[g]).join(" "), tps: Math.round(s.tps * 10) / 10, prefill: got && secs ? Math.round(got / secs) : null, served };
  return { passed: GATES.every((g) => ok[g]), proof, evidence: { ok, ...ev } };
};
