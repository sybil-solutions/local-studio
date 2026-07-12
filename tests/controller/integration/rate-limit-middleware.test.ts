import { describe, expect, test } from "bun:test";
import { Hono } from "../../../controller/node_modules/hono";
import {
  createMutatingRateLimitMiddleware,
  createReadRateLimitMiddleware,
} from "../../../controller/src/http/security-middleware";
import { createTestHarness, registerControllerTestLifecycle } from "./fixtures";

registerControllerTestLifecycle();

describe("rate limit middleware", () => {
  test("mutating limiter emits headers then 429 past the window ceiling", async () => {
    const { context } = await createTestHarness();
    const app = new Hono();
    app.use("*", createMutatingRateLimitMiddleware(context, { maxRequests: 2, windowMs: 60_000 }));
    app.post("/rl-mutating-probe", (ctx) => ctx.json({ ok: true }));

    const first = await app.request("/rl-mutating-probe", { method: "POST" });
    expect(first.status).toBe(200);
    expect(first.headers.get("X-RateLimit-Limit")).toBe("2");
    expect(first.headers.get("X-RateLimit-Remaining")).toBe("1");

    const second = await app.request("/rl-mutating-probe", { method: "POST" });
    expect(second.status).toBe(200);
    expect(second.headers.get("X-RateLimit-Remaining")).toBe("0");

    const third = await app.request("/rl-mutating-probe", { method: "POST" });
    expect(third.status).toBe(429);
    expect(third.headers.get("Retry-After")).toBeTruthy();
    expect(await third.json()).toEqual({ detail: "Rate limit exceeded" });
  });

  test("read limiter skips mutations and 429s reads past the ceiling", async () => {
    const { context } = await createTestHarness();
    const app = new Hono();
    app.use("*", createReadRateLimitMiddleware(context, { maxRequests: 1, windowMs: 60_000 }));
    app.get("/rl-read-probe", (ctx) => ctx.json({ ok: true }));
    app.post("/rl-read-probe", (ctx) => ctx.json({ ok: true }));

    const mutating = await app.request("/rl-read-probe", { method: "POST" });
    expect(mutating.status).toBe(200);

    const firstRead = await app.request("/rl-read-probe");
    expect(firstRead.status).toBe(200);

    const secondRead = await app.request("/rl-read-probe");
    expect(secondRead.status).toBe(429);
    expect(secondRead.headers.get("Retry-After")).toBeTruthy();
  });
});
