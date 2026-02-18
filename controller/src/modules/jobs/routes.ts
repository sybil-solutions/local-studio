// CRITICAL
import type { Hono } from "hono";
import type { AppContext } from "../../types/context";
import type { JobManager } from "./job-manager";
import { badRequest, notFound } from "../../core/errors";

/**
 * Register jobs API routes.
 * @param app - Hono application.
 * @param jobManager - Job manager instance.
 */
export const registerJobsRoutes = (
  app: Hono,
  _context: AppContext,
  jobManager: JobManager,
): void => {
  app.post("/jobs", async (ctx) => {
    const body = await ctx.req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw badRequest("Invalid JSON payload");
    }

    const type = typeof body["type"] === "string" ? body["type"] : "";
    if (!type) {
      throw badRequest("type is required");
    }

    const input =
      body["input"] && typeof body["input"] === "object"
        ? (body["input"] as Record<string, unknown>)
        : {};

    try {
      const job = await jobManager.createJob(type, input);
      return ctx.json({ job }, { status: 201 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw badRequest(msg);
    }
  });

  app.get("/jobs", (ctx) => {
    const limit = Number(ctx.req.query("limit") ?? 50);
    const jobs = jobManager.listJobs(Math.min(limit, 200));
    return ctx.json({ jobs });
  });

  app.get("/jobs/:jobId", (ctx) => {
    const jobId = ctx.req.param("jobId");
    const job = jobManager.getJob(jobId);
    if (!job) {
      throw notFound("Job not found");
    }
    return ctx.json({ job });
  });
};
