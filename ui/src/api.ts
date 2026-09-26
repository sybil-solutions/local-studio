import type { ControllerEvent, ControllerEventType } from "@local-studio/contracts/client";

const KEY = "ls.key";

export const getKey = (): string | null => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

export const setKey = (k: string | null): void => {
  try {
    if (k) localStorage.setItem(KEY, k);
    else localStorage.removeItem(KEY);
  } catch {}
};

export type Res<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void): void => {
  onUnauthorized = fn;
};

const headers = (extra?: Record<string, string>): Record<string, string> => {
  const h: Record<string, string> = { ...extra };
  const k = getKey();
  if (k) h.authorization = `Bearer ${k}`;
  return h;
};

export async function call<T>(method: string, path: string, body?: unknown, timeoutMs = 15_000): Promise<Res<T>> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(path, {
      method,
      headers: headers(body !== undefined ? { "content-type": "application/json" } : undefined),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    });
    if (r.status === 401) onUnauthorized();
    const ct = r.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const j = (await r.json()) as unknown;
      if (r.ok) return { ok: true, data: j as T };
      const e = (j as { error?: { message?: string } | string }).error;
      return { ok: false, status: r.status, error: typeof e === "string" ? e : e?.message ?? `HTTP ${r.status}` };
    }
    if (ct.startsWith("text/plain") && r.ok) return { ok: true, data: (await r.text()) as T };
    return { ok: false, status: r.status, error: r.ok ? "not available on this controller yet" : `HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, status: 0, error: ctl.signal.aborted ? "timed out" : String(e) };
  } finally {
    clearTimeout(t);
  }
}

export const get = <T>(path: string) => call<T>("GET", path);
export const post = <T>(path: string, body: unknown = {}) => call<T>("POST", path, body);

export const via = (peerId: string | null, path: string): string => (peerId ? `/api/peers/${encodeURIComponent(peerId)}${path}` : path);

export type ConnState = "connecting" | "live" | "retrying";

export function events(types: ControllerEventType[], onEvent: (e: ControllerEvent) => void, onState: (s: ConnState, retryMs?: number) => void): () => void {
  let stopped = false;
  let ctl: AbortController | null = null;
  let delay = 1000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = async () => {
    if (stopped) return;
    ctl = new AbortController();
    onState("connecting");
    try {
      const r = await fetch(`/api/events?types=${types.join(",")}`, { headers: headers({ accept: "text/event-stream" }), signal: ctl.signal });
      if (r.status === 401) onUnauthorized();
      if (!r.ok || !r.body || !(r.headers.get("content-type") ?? "").includes("text/event-stream")) throw new Error(`HTTP ${r.status}`);
      onState("live");
      delay = 1000;
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          let type = "";
          let data = "";
          for (const line of block.split("\n")) {
            if (line.startsWith("event:")) type = line.slice(6).trim();
            else if (line.startsWith("data:")) data += line.slice(5).trimStart();
          }
          if (!type || !data) continue;
          try {
            onEvent({ type, data: JSON.parse(data) } as ControllerEvent);
          } catch {}
        }
      }
    } catch {}
    if (stopped) return;
    onState("retrying", delay);
    timer = setTimeout(run, delay);
    delay = Math.min(delay * 2, 15_000);
  };
  void run();
  return () => {
    stopped = true;
    clearTimeout(timer);
    ctl?.abort();
  };
}
