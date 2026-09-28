import { Hono } from "hono";
import { StopModelBody } from "@local-studio/contracts";
import type { Env, LifecycleService, RuntimeService } from "../context";

const err = (code: string, message: string) => ({ error: { code, message } });

export const discoveryRoutes = (runtime: RuntimeService, lifecycle: LifecycleService): Hono<Env> => {
  const r = new Hono<Env>();
  r.post("/api/models/:id/stop", async (c) => {
    const id = c.req.param("id");
    const parsed = StopModelBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json(err("BAD_REQUEST", "body must be {confirm: <model id>, force?: boolean}"), 400);
    if (!runtime.model(id)) return c.json(err("NOT_FOUND", `model ${id} not found`), 404);
    const res = await lifecycle.stop(id, parsed.data);
    return res.ok ? c.json(res) : c.json(err("STOP_REFUSED", res.detail), 409);
  });
  r.get("/api/launches", (c) => c.json(lifecycle.progress()));
  r.post("/api/launches/:id/cancel", (c) => {
    const ok = lifecycle.cancel(c.req.param("id"));
    return ok ? c.json(lifecycle.progress()) : c.json(err("NOT_FOUND", "no active launch with that id"), 404);
  });
  return r;
};
