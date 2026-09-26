import type { Ctx } from "../context";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "proxy-connection",
]);

const REQUEST_DROP = new Set(["host", "authorization", "x-api-key", "cookie", "content-length", "origin", "referer", "accept-encoding"]);
const RESPONSE_DROP = new Set(["content-length", "content-encoding", "set-cookie"]);
const STREAM_CEILING_MS = 7 * 24 * 3600 * 1000;
export const HEADERS_TIMEOUT_MS = 5000;

const connectionTokens = (h: Headers): Set<string> =>
  new Set(
    (h.get("connection") ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );

export const cleanRequestHeaders = (src: Headers | Record<string, string> | undefined): Headers => {
  const inH = new Headers(src);
  const extra = connectionTokens(inH);
  const out = new Headers();
  inH.forEach((v, k) => {
    const n = k.toLowerCase();
    if (HOP_BY_HOP.has(n) || REQUEST_DROP.has(n) || extra.has(n)) return;
    out.set(k, v);
  });
  return out;
};

export const cleanResponseHeaders = (src: Headers): Headers => {
  const extra = connectionTokens(src);
  const out = new Headers();
  src.forEach((v, k) => {
    const n = k.toLowerCase();
    if (HOP_BY_HOP.has(n) || RESPONSE_DROP.has(n) || extra.has(n)) return;
    out.append(k, v);
  });
  return out;
};

export const upstreamFetch = async (
  ctx: Ctx,
  url: string,
  init: RequestInit & { timeoutMs?: number },
): Promise<Response> => {
  const { timeoutMs, signal, ...rest } = init;
  const headersCtl = new AbortController();
  const timer = setTimeout(() => headersCtl.abort(new DOMException(`no response headers within ${timeoutMs ?? HEADERS_TIMEOUT_MS} ms`, "TimeoutError")), timeoutMs ?? HEADERS_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, headersCtl.signal]) : headersCtl.signal;
  try {
    const hasBody = rest.body !== undefined && rest.body !== null;
    return await ctx.fetch(url, { ...rest, signal: combined, timeoutMs: STREAM_CEILING_MS, ...(hasBody ? { duplex: "half" } : {}) } as RequestInit & {
      timeoutMs: number;
    });
  } finally {
    clearTimeout(timer);
  }
};

export const proxyToPeer = async (
  ctx: Ctx,
  peer: { baseUrl: string; key: string },
  rest: string,
  req: Request,
): Promise<Response> => {
  const headers = cleanRequestHeaders(req.headers);
  headers.set("authorization", `Bearer ${peer.key}`);
  headers.set("x-local-studio-via", ctx.identity.machineId);
  const method = req.method.toUpperCase();
  const body = method === "GET" || method === "HEAD" ? undefined : req.body ?? undefined;
  let res: Response;
  try {
    res = await upstreamFetch(ctx, `${peer.baseUrl}${rest}`, { method, headers, body, signal: req.signal, timeoutMs: HEADERS_TIMEOUT_MS });
  } catch (e) {
    const timeout = e instanceof Error && e.name === "TimeoutError";
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: { code: timeout ? "PEER_TIMEOUT" : "PEER_UNREACHABLE", message: msg } }, { status: timeout ? 504 : 502 });
  }
  return new Response(method === "HEAD" ? null : res.body, { status: res.status, statusText: res.statusText, headers: cleanResponseHeaders(res.headers) });
};
