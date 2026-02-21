import { describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";
import type { Context } from "hono";
import { HttpStatus } from "../../core/errors";
import type { AppContext } from "../../types/context";
import { registerJobsRoutes } from "./routes";

const withHttpStatusErrorHandler = (app: Hono): void => {
  app.onError((error, ctx: Context) => {
    if (error instanceof HttpStatus) {
      return ctx.json({ error: String(error) }, { status: error.status });
    }
    return ctx.json({ error: String(error) }, { status: 500 });
  });
};

describe("jobs routes", () => {
  it("falls back to default list limit for invalid limit query", async () => {
    const app = new Hono();
    withHttpStatusErrorHandler(app);
    const listJobs = mock(() => []);
    registerJobsRoutes(app, {} as AppContext, {
      createJob: mock(() => Promise.resolve({})),
      listJobs,
      getJob: mock(() => null),
    } as unknown as Parameters<typeof registerJobsRoutes>[2]);

    const response = await app.request("/jobs?limit=abc");
    expect(response.status).toBe(200);
    expect(listJobs).toHaveBeenCalledWith(50);
  });

  it("clamps list limit to 200", async () => {
    const app = new Hono();
    withHttpStatusErrorHandler(app);
    const listJobs = mock(() => []);
    registerJobsRoutes(app, {} as AppContext, {
      createJob: mock(() => Promise.resolve({})),
      listJobs,
      getJob: mock(() => null),
    } as unknown as Parameters<typeof registerJobsRoutes>[2]);

    const response = await app.request("/jobs?limit=500");
    expect(response.status).toBe(200);
    expect(listJobs).toHaveBeenCalledWith(200);
  });

  it("falls back to default list limit for non-positive limit values", async () => {
    const app = new Hono();
    withHttpStatusErrorHandler(app);
    const listJobs = mock(() => []);
    registerJobsRoutes(app, {} as AppContext, {
      createJob: mock(() => Promise.resolve({})),
      listJobs,
      getJob: mock(() => null),
    } as unknown as Parameters<typeof registerJobsRoutes>[2]);

    const response = await app.request("/jobs?limit=-1");
    expect(response.status).toBe(200);
    expect(listJobs).toHaveBeenCalledWith(50);
  });
});
