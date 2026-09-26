import { randomBytes } from "node:crypto";
import type { Hono } from "hono";
import { renderSVG } from "uqr";
import type { Env } from "../context";
import type { KeyStore } from "./keys";

const TTL_MS = 5 * 60 * 1000;
const PAGE = (body: string) =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Local Studio</title><body style="margin:0;background:#000;color:#d4d4d4;font:13px ui-monospace,monospace;display:grid;place-items:center;min-height:100vh">${body}</body>`;
const REDEEM = `<p id="s">…</p><script>fetch(location.pathname,{method:"POST"}).then(r=>r.ok?r.json():Promise.reject(r.status)).then(j=>{localStorage.setItem("ls.key",j.key);location.replace("/")}).catch(e=>{document.getElementById("s").textContent="expired "+e})</script>`;

export const pairing = { base: null as string | null };

export const mountPairing = (hono: Hono<Env>, keys: KeyStore): void => {
  const codes = new Map<string, number>();
  const html = (body: string, status: 200 | 403 | 409 = 200) =>
    new Response(PAGE(body), { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  hono.get("/pair", (c) => {
    if (!c.get("admin")) return html("403", 403);
    if (!pairing.base) return html("tailnet off", 409);
    const now = Date.now();
    for (const [k, exp] of codes) if (exp < now) codes.delete(k);
    const code = randomBytes(18).toString("base64url");
    codes.set(code, now + TTL_MS);
    const url = `${pairing.base}/pair/${code}`;
    const qr = renderSVG(url, { border: 2, pixelSize: 8, whiteColor: "#fff", blackColor: "#000" });
    return html(`<div style="display:grid;gap:12px;justify-items:center"><div style="width:280px">${qr.replace("<svg", '<svg width="280" height="280"')}</div><code style="word-break:break-all;max-width:320px">${url}</code></div>`);
  });
  hono.get("/pair/:code", (c) => html(codes.has(c.req.param("code")) ? REDEEM : "expired"));
  hono.post("/pair/:code", (c) => {
    const code = c.req.param("code");
    const exp = codes.get(code);
    codes.delete(code);
    if (!exp || exp < Date.now()) return c.json({ error: { code: "AUTH", message: "pairing code expired" } }, 410);
    const { key } = keys.issue("ui", `phone ${new Date().toISOString().slice(0, 16)}`, "admin");
    return c.json({ key }, 200, { "cache-control": "no-store" });
  });
};
