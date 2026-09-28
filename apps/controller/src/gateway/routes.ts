import type { Context } from "hono";
import { Hono } from "hono";
import type { Dialect, ErrorCode, Finish, RequestRecord, RunningModel, TokenBuckets, UsageSource } from "@local-studio/contracts";
import { classifyError, decodeMs, decodeTps, prefillTps, promptTotal, ttftMs } from "@local-studio/contracts";
import type { Ctx, Env, FinishDraft, RequestHandle, Services } from "../context";
import type { CEvent, CFinish, CRequest, Encoder, Json } from "./canonical";
import { DialectError, SseParser, estimateTokens, isContentEvent, isObj, str } from "./canonical";
import { ChatAggregator, ChatUpstreamDecoder, chatErrorBody, chatErrorFrame, decodeChatRequest, isUsageOnlyChunk, patchUsageChunk, preparePassthrough } from "./dialects/chat";
import { MessagesEncoder, decodeMessagesRequest, messagesErrorBody } from "./dialects/messages";
import { ResponsesEncoder, decodeResponsesRequest, responsesErrorBody } from "./dialects/responses";
import type { Route } from "./route-model";
import { gatewayModels, listedName, resolveModel } from "./route-model";
import { CONNECT_TIMEOUT_MS, openUpstream, toChatBody } from "./upstream";

type C = Context<Env>;

const PATHS: Record<Dialect, string> = { chat: "/v1/chat/completions", responses: "/v1/responses", messages: "/v1/messages" };
const KEEPALIVE_MS = 15_000;
const PEER_NONSTREAM_MS = 6 * 3600_000;
const STALL_MS = 15 * 60_000;
const enc = new TextEncoder();

const errorBody = (d: Dialect, code: ErrorCode, message: string, status: number) =>
  d === "chat" ? chatErrorBody(code, message) : d === "responses" ? responsesErrorBody(code, message) : messagesErrorBody(code, message, status);

const errorJson = (d: Dialect, status: number, code: ErrorCode, message: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(errorBody(d, code, message, status)), { status, headers: { "content-type": "application/json", ...headers } });

interface Meta {
  dialect: Dialect;
  stream: boolean;
  client: string;
  workspaceId: string | null;
  sessionId: string | null;
  tsStart: number;
  model: string;
  capsStripped: string[];
}

const ZERO: TokenBuckets = { inputUncached: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 };

export const gatewayRoutes = (ctx: Ctx, svc: Services): Hono<Env> => {
  const r = new Hono<Env>();
  const firstScan = async () => {
    if (svc.runtime.view().discovery.lastScanAt === null) await svc.runtime.rescan();
  };
  let inflight = 0;
  let lastMissScan = 0;
  ctx.obs.gauge("gateway.inflight", () => inflight);

  const draft = (
    h: RequestHandle,
    m: Meta,
    x: Partial<RequestRecord> & { status: number; finish: Finish; tsEnd: number; cachedReported?: boolean },
  ): FinishDraft => {
    const b: TokenBuckets = {
      inputUncached: x.inputUncached ?? 0,
      cacheRead: x.cacheRead ?? 0,
      cacheWrite: x.cacheWrite ?? 0,
      output: x.output ?? 0,
      reasoning: x.reasoning ?? 0,
    };
    const pt = promptTotal(b);
    const first = x.tsFirstToken ?? null;
    const t = ttftMs(m.tsStart, first);
    const dMs = decodeMs(first, x.tsEnd);
    const usageSource: UsageSource = x.usageSource ?? "none";
    return {
      id: h.id,
      tsStart: m.tsStart,
      tsUpstream: x.tsUpstream ?? null,
      tsFirstToken: first,
      tsEnd: x.tsEnd,
      machineId: ctx.identity.machineId,
      modelId: x.modelId ?? null,
      model: m.model,
      engine: x.engine ?? null,
      client: m.client,
      workspaceId: m.workspaceId,
      sessionId: m.sessionId,
      dialect: m.dialect,
      stream: m.stream,
      via: x.via ?? "local",
      peerId: x.peerId ?? null,
      status: x.status,
      finish: x.finish,
      errorCode: x.errorCode ?? null,
      errorMessage: x.errorMessage ? x.errorMessage.slice(0, 2000) : null,
      ...b,
      promptTotal: pt,
      total: pt + b.output,
      usageSource,
      contextWindow: x.contextWindow ?? null,
      ttftMs: t,
      decodeMs: dMs,
      prefillTps: usageSource === "estimated" ? null : prefillTps(b.inputUncached, t),
      decodeTps: usageSource === "estimated" ? null : decodeTps(b.output, dMs),
      capsStripped: m.capsStripped,
      cachedReported: x.cachedReported ?? false,
    };
  };

  const fail = async (m: Meta, status: number, code: ErrorCode, message: string, extra: Partial<RequestRecord> = {}, headers: Record<string, string> = {}) => {
    const h = await svc.metrics.begin(null, m.tsStart);
    await svc.metrics.finish(h, draft(h, m, { ...extra, status, finish: code === "ABORTED" ? "aborted" : "error", errorCode: code, errorMessage: message, tsEnd: Date.now() }));
    return errorJson(m.dialect, status, code, message, { "x-request-id": h.id, ...headers });
  };

  const handle = async (c: C, dialect: Dialect): Promise<Response> => {
    const t0 = performance.now();
    try {
      (c.env as { timeout?: (req: Request, s: number) => void } | undefined)?.timeout?.(c.req.raw, 0);
    } catch {}
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      body = null;
    }
    const tsStart = Date.now();
    const m: Meta = {
      dialect,
      stream: isObj(body) && body.stream === true,
      client: c.get("client") ?? "api",
      workspaceId: c.req.header("x-local-studio-workspace") ?? null,
      sessionId: c.req.header("x-session-id") ?? c.req.header("x-claude-code-session-id") ?? c.req.header("session_id") ?? null,
      tsStart,
      model: isObj(body) ? str(body.model) ?? "" : "",
      capsStripped: [],
    };
    if (!isObj(body)) return fail(m, 400, "INVALID_REQUEST", "request body must be a JSON object");
    if (!m.model) return fail(m, 400, "INVALID_REQUEST", "model is required");
    await firstScan();
    let route = resolveModel(svc, m.model);
    for (let i = 0; i < 2 && route.kind === "missing" && Date.now() - lastMissScan > 1000; i++) {
      const d = (await svc.runtime.rescan()).discovery;
      route = resolveModel(svc, m.model);
      if ((d.lastScanAt ?? 0) - (d.scanMs ?? 0) >= tsStart) lastMissScan = Date.now();
    }
    if (route.kind === "missing") return fail(m, 404, "MODEL_NOT_FOUND", `model '${m.model}' is not served here or on any connected machine`);
    if (route.kind === "loading") {
      m.model = listedName(route.model, route.served);
      return fail(m, 503, "SERVER", `model '${route.served}' is ${route.model.state}; retry shortly`, { modelId: route.model.id, engine: route.model.engine }, { "retry-after": "10" });
    }
    m.model = route.kind === "local" ? listedName(route.model, route.served) : route.served;
    if (route.kind === "peer") return forwardPeer(c, m, body, route);
    return runLocal(c, m, body, route.model, route.served, t0);
  };

  const forwardPeer = async (c: C, m: Meta, body: Json, route: Extract<Route, { kind: "peer" }>): Promise<Response> => {
    const h = await svc.metrics.begin(null, m.tsStart);
    const peerFields = { via: "peer" as const, peerId: route.peer.id, engine: route.gm.engine, contextWindow: route.gm.contextWindow };
    let res: Response;
    try {
      res = await svc.peers.fetch(route.peer.id, PATHS[m.dialect], {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: c.req.header("accept") ?? "application/json",
          "x-local-studio-client": m.client,
          "x-local-studio-via": ctx.identity.machineId,
          "x-request-id": h.id,
          ...(m.workspaceId ? { "x-local-studio-workspace": m.workspaceId } : {}),
          ...(m.sessionId ? { "x-session-id": m.sessionId } : {}),
          ...(c.req.header("anthropic-version") ? { "anthropic-version": c.req.header("anthropic-version")! } : {}),
        },
        body: JSON.stringify({ ...body, model: route.served }),
        signal: c.req.raw.signal,
        timeoutMs: m.stream ? CONNECT_TIMEOUT_MS : PEER_NONSTREAM_MS,
      });
    } catch (e) {
      const aborted = c.req.raw.signal.aborted;
      const code: ErrorCode = aborted ? "ABORTED" : "TRANSPORT";
      await svc.metrics.finish(h, draft(h, m, { ...peerFields, status: aborted ? 499 : 502, finish: aborted ? "aborted" : "error", errorCode: code, errorMessage: String(e), tsEnd: Date.now() }));
      return errorJson(m.dialect, aborted ? 499 : 502, code, `peer ${route.peer.name}: ${String(e)}`, { "x-request-id": h.id });
    }
    const tsUpstream = Date.now();
    const status = res.status;
    let settled = false;
    const settle = async (errorCode: ErrorCode | null, message: string | null, st = status) => {
      if (settled) return;
      settled = true;
      await svc.metrics.finish(
        h,
        draft(h, m, { ...peerFields, tsUpstream, status: st, finish: errorCode === "ABORTED" ? "aborted" : errorCode ? "error" : "stop", errorCode, errorMessage: message, tsEnd: Date.now() }),
      );
    };
    const headers = new Headers({ "content-type": res.headers.get("content-type") ?? "application/json", "x-request-id": h.id });
    const up = res.headers.get("x-request-id");
    if (up) headers.set("x-upstream-request-id", up);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      await settle(classifyError(status, text), text.slice(0, 2000));
      return new Response(text, { status, headers });
    }
    const reader = res.body?.getReader();
    const out = new ReadableStream<Uint8Array>({
      async pull(ctrl) {
        try {
          const { done, value } = reader ? await reader.read() : { done: true, value: undefined };
          if (done) {
            ctrl.close();
            await settle(null, null);
          } else ctrl.enqueue(value);
        } catch (e) {
          await settle(c.req.raw.signal.aborted ? "ABORTED" : "TRANSPORT", String(e), c.req.raw.signal.aborted ? 499 : 502);
          try {
            ctrl.close();
          } catch {}
        }
      },
      async cancel() {
        await reader?.cancel().catch(() => {});
        await settle("ABORTED", "client disconnected", 499);
      },
    });
    return new Response(out, { status, headers });
  };

  const runLocal = async (c: C, m: Meta, body: Json, model: RunningModel, served: string, t0: number): Promise<Response> => {
    let upBody: Json;
    let wantsUsage = false;
    let encoder: Encoder | null = null;
    let canonical: CRequest | null = null;
    try {
      if (m.dialect === "chat") {
        const pt = preparePassthrough(body, served);
        upBody = pt.body;
        m.capsStripped = pt.capsStripped;
        wantsUsage = pt.wantsUsage;
      } else if (m.dialect === "responses") {
        const d = decodeResponsesRequest(body);
        canonical = d.req;
        upBody = toChatBody(d.req, served);
        m.capsStripped = d.req.capsStripped;
        encoder = new ResponsesEncoder(m.model, d.customTools);
      } else {
        canonical = decodeMessagesRequest(body);
        upBody = toChatBody(canonical, served);
        m.capsStripped = canonical.capsStripped;
        encoder = new MessagesEncoder(m.model);
      }
    } catch (e) {
      if (e instanceof DialectError) return fail(m, e.status, e.code, e.message, { modelId: model.id, engine: model.engine });
      throw e;
    }
    const base = { modelId: model.id, engine: model.engine, contextWindow: model.contextWindow };
    const tb = performance.now();
    const h = await svc.metrics.begin(model.id, m.tsStart);
    ctx.obs.observe("gateway.attribution_begin_ms", performance.now() - tb);
    ctx.obs.observe("gateway.pre_upstream_ms", performance.now() - t0);
    m.tsStart = Date.now();
    const outHeaders: Record<string, string> = { "x-request-id": h.id };
    let open: Awaited<ReturnType<typeof openUpstream>>;
    try {
      open = await openUpstream(`${model.baseUrl}/v1/chat/completions`, upBody, { "x-request-id": h.id }, c.req.raw.signal);
    } catch (e) {
      const aborted = c.req.raw.signal.aborted;
      const timeout = !aborted && String(e).toLowerCase().includes("timeout");
      const code: ErrorCode = aborted ? "ABORTED" : timeout ? "TIMEOUT" : "TRANSPORT";
      const status = aborted ? 499 : timeout ? 504 : 502;
      await svc.metrics.finish(h, draft(h, m, { ...base, status, finish: aborted ? "aborted" : "error", errorCode: code, errorMessage: `upstream: ${String(e)}`, tsEnd: Date.now() }));
      return errorJson(m.dialect, status, code, `upstream ${model.id}: ${String(e)}`, outHeaders);
    }
    const tsUpstream = Date.now();
    const res = open.res;
    const upId = res.headers.get("x-request-id");
    if (upId) outHeaders["x-upstream-request-id"] = upId;
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      let msg = text.slice(0, 2000);
      try {
        const j = JSON.parse(text) as Json;
        msg = (isObj(j.error) ? str(j.error.message) : str(j.message)) ?? msg;
      } catch {}
      const code = classifyError(res.status, msg);
      await svc.metrics.finish(h, draft(h, m, { ...base, tsUpstream, status: res.status, finish: "error", errorCode: code, errorMessage: msg, tsEnd: Date.now() }));
      return errorJson(m.dialect, res.status, code, msg, outHeaders);
    }

    const dec = new ChatUpstreamDecoder();
    const agg = m.dialect === "chat" && !m.stream ? new ChatAggregator(() => dec.reasoningField) : null;
    let clientGone = false;
    let lastWrite = Date.now();
    let lastRead = Date.now();
    let sink: (s: string) => void = () => {};
    let pending = "";
    const emit = (s: string) => {
      pending += s;
    };
    const flushOut = () => {
      if (!pending) return;
      lastWrite = Date.now();
      sink(pending);
      pending = "";
    };
    const stall = setInterval(() => {
      if (Date.now() - lastRead > STALL_MS) open.abort.abort(new DOMException(`no bytes from upstream for ${STALL_MS / 60000} min`, "TimeoutError"));
    }, 30_000);

    const pump = async (): Promise<{ rec: RequestRecord; finish: CFinish | null; error: { code: ErrorCode; message: string; status: number } | null; rawUsage: unknown }> => {
      const parser = new SseParser();
      const td = new TextDecoder();
      const reader = res.body!.getReader();
      let usage: TokenBuckets | null = null;
      let rawUsage: unknown = null;
      let finish: CFinish | null = null;
      let first: number | null = null;
      let heldUsage: Json | null = null;
      let upstreamError: Extract<CEvent, { t: "error" }> | null = null;
      let transport: string | null = null;
      let sawDone = false;
      let contentEvents = 0;
      let tsEnd = Date.now();
      inflight++;
      if (encoder && m.stream) emit((encoder as ResponsesEncoder | MessagesEncoder).begin());
      try {
        outer: for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const tc = performance.now();
          lastRead = Date.now();
          for (const ev of parser.push(td.decode(value, { stream: true }))) {
            if (ev.data === "[DONE]") {
              sawDone = true;
              tsEnd = Date.now();
              break outer;
            }
            let chunk: unknown;
            try {
              chunk = JSON.parse(ev.data);
            } catch {
              continue;
            }
            if (!isObj(chunk)) continue;
            const now = Date.now();
            const events = dec.decode(chunk);
            for (const e of events) {
              if (isContentEvent(e)) {
                first ??= now;
                contentEvents++;
              }
              if (e.t === "usage") {
                usage = e.usage;
                rawUsage = e.raw;
              } else if (e.t === "finish") finish = e.reason;
              else if (e.t === "error") upstreamError = e;
              agg?.onEvent(e);
              if (encoder && e.t !== "usage" && e.t !== "finish" && e.t !== "error") {
                const s = encoder.onEvent(e);
                if (m.stream) emit(s);
              }
            }
            if (m.dialect === "chat" && m.stream) {
              if (isUsageOnlyChunk(chunk)) heldUsage = chunk;
              else emit(`${ev.raw}\n\n`);
            }
          }
          flushOut();
          ctx.obs.observe("gateway.chunk_us", (performance.now() - tc) * 1000);
        }
        tsEnd = Date.now();
        if (sawDone) void reader.cancel().catch(() => {});
      } catch (e) {
        tsEnd = Date.now();
        transport = String(e);
      } finally {
        clearInterval(stall);
        inflight--;
      }
      const aborted = clientGone || c.req.raw.signal.aborted;
      let error: { code: ErrorCode; message: string; status: number } | null = null;
      if (aborted) error = { code: "ABORTED", message: "client disconnected", status: 499 };
      else if (upstreamError) error = { code: classifyError(upstreamError.status, upstreamError.message), message: upstreamError.message, status: upstreamError.status ?? 500 };
      else if (transport) error = { code: classifyError(null, transport), message: `upstream stream failed: ${transport}`, status: 502 };
      else if (!sawDone) error = { code: "TRANSPORT", message: "upstream stream ended before [DONE]", status: 502 };
      else if (contentEvents === 0) error = { code: "EMPTY_RESPONSE", message: "upstream returned no content", status: 200 };
      let usageSource: UsageSource = "engine";
      if (!usage) {
        usageSource = "estimated";
        const req = canonical ?? (() => {
          try {
            return decodeChatRequest(body);
          } catch {
            return null;
          }
        })();
        usage = { ...ZERO, inputUncached: req ? estimateTokens(req) : 0, output: contentEvents };
      }
      const recFinish: Finish = error ? (error.code === "ABORTED" ? "aborted" : error.code === "EMPTY_RESPONSE" ? (finish === "tool_calls" ? "tool_calls" : finish === "length" ? "length" : "stop") : "error") : finish === "content_filter" || !finish ? "stop" : finish;
      const d = draft(h, m, {
        ...base,
        ...usage,
        tsUpstream,
        tsFirstToken: first,
        tsEnd,
        status: error?.status ?? 200,
        finish: recFinish,
        errorCode: error?.code ?? null,
        errorMessage: error?.message ?? null,
        usageSource,
        cachedReported: dec.cachedReported(),
      });
      const rec = svc.metrics.preview(h, d);
      void svc.metrics.finish(h, d).catch((e) => ctx.log.error(`metrics finish ${h.id}: ${String(e)}`, "metrics.finish"));
      if (m.stream && !aborted) {
        if (m.dialect === "chat") {
          if (heldUsage && wantsUsage) emit(`data: ${JSON.stringify(rec.cacheSource ? patchUsageChunk(heldUsage, rec) : heldUsage)}\n\n`);
          if (error && error.code !== "EMPTY_RESPONSE" && !upstreamError) emit(chatErrorFrame(error.code, error.message));
          else emit("data: [DONE]\n\n");
        } else if (encoder) {
          if (error && error.code !== "EMPTY_RESPONSE") emit(encoder.fail(error.code, error.message));
          else emit(encoder.finish(rec, finish));
        }
        flushOut();
      }
      return { rec, finish, error, rawUsage };
    };

    if (!m.stream) {
      const onAbort = () => {
        clientGone = true;
      };
      c.req.raw.signal.addEventListener("abort", onAbort, { once: true });
      const { rec, finish, error, rawUsage } = await pump();
      if (error && error.code !== "EMPTY_RESPONSE") return errorJson(m.dialect, error.status, error.code, error.message, outHeaders);
      let out: unknown;
      if (agg) out = agg.result(rec, finish, rawUsage);
      else {
        encoder!.finish(rec, finish);
        out = encoder!.result();
      }
      return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json", ...outHeaders } });
    }

    let keepalive: ReturnType<typeof setInterval> | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        let closed = false;
        sink = (s) => {
          if (closed) return;
          try {
            ctrl.enqueue(enc.encode(s));
          } catch {
            closed = true;
          }
        };
        keepalive = setInterval(() => {
          if (Date.now() - lastWrite >= KEEPALIVE_MS - 50) sink(": keepalive\n\n");
        }, KEEPALIVE_MS);
        void pump()
          .catch((e) => ctx.log.error(`gateway pump ${h.id}: ${String(e)}`, "gateway.pump"))
          .finally(() => {
            clearInterval(keepalive);
            closed = true;
            try {
              ctrl.close();
            } catch {}
          });
      },
      cancel() {
        clientGone = true;
        clearInterval(keepalive);
        open.abort.abort(new DOMException("client disconnected", "AbortError"));
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no", ...outHeaders },
    });
  };

  r.post("/v1/chat/completions", (c) => handle(c, "chat"));
  r.post("/v1/responses", (c) => handle(c, "responses"));
  r.post("/v1/messages", (c) => handle(c, "messages"));

  r.post("/v1/messages/count_tokens", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!isObj(body)) return errorJson("messages", 400, "INVALID_REQUEST", "request body must be a JSON object");
    const req = decodeMessagesRequest(body);
    const route = req.model ? resolveModel(svc, req.model) : ({ kind: "missing" } as const);
    if (route.kind === "peer") {
      try {
        const res = await svc.peers.fetch(route.peer.id, "/v1/messages/count_tokens", {
          method: "POST",
          headers: { "content-type": "application/json", "x-local-studio-client": c.get("client") ?? "api" },
          body: JSON.stringify({ ...body, model: route.served }),
          timeoutMs: 10_000,
        });
        if (res.ok) return c.json(await res.json());
      } catch {}
    }
    if (route.kind === "local" && route.model.engine !== "llamacpp") {
      try {
        const up = toChatBody(req, route.served);
        const res = await ctx.fetch(`${route.model.baseUrl}/tokenize`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: route.served, messages: up.messages, ...(up.tools ? { tools: up.tools } : {}), add_generation_prompt: true }),
          timeoutMs: 5000,
        });
        if (res.ok) {
          const j = (await res.json()) as { count?: number; tokens?: unknown[] };
          const n = j.count ?? j.tokens?.length;
          if (typeof n === "number") return c.json({ input_tokens: n });
        }
      } catch {}
    }
    return c.json({ input_tokens: estimateTokens(req) });
  });

  r.get("/v1/models", async (c) => {
    await firstScan();
    const list = gatewayModels(ctx, svc);
    if (c.req.header("anthropic-version"))
      return c.json({
        data: list.map((g) => ({ id: g.id, type: "model", display_name: g.id, created_at: new Date(0).toISOString() })),
        has_more: false,
        first_id: list[0]?.id ?? null,
        last_id: list[list.length - 1]?.id ?? null,
      });
    return c.json({
      object: "list",
      data: list.map((g) => ({
        id: g.id,
        object: "model",
        created: 0,
        owned_by: g.machineName,
        context_length: g.contextWindow,
        contextWindow: g.contextWindow,
        max_model_len: g.contextWindow,
        local_studio: { machineId: g.machineId, modelId: g.modelId, engine: g.engine, state: g.state, vision: g.vision, via: g.via },
      })),
    });
  });

  return r;
};
