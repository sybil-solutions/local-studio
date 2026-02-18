// CRITICAL
import type { Hono } from "hono";
import { badRequest, notFound } from "../../core/errors";
import type { DistributedClusterManager, HeartbeatInput, RegisterNodeInput } from "./cluster-manager";

/**
 * Register distributed control-plane routes.
 * @param app - Hono app.
 * @param manager - Distributed cluster manager.
 */
export const registerDistributedRoutes = (app: Hono, manager: DistributedClusterManager): void => {
  app.post("/distributed/nodes/register", async (ctx) => {
    const body = await ctx.req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw badRequest("Invalid JSON payload");
    }
    const nodeId = typeof body["node_id"] === "string" ? body["node_id"] : "";
    if (!nodeId) {
      throw badRequest("node_id is required");
    }
    const portRaw = body["port"];
    const port =
      typeof portRaw === "number" && Number.isInteger(portRaw) && portRaw >= 0 ? portRaw : undefined;

    try {
      const input: RegisterNodeInput = { node_id: nodeId };
      if (typeof body["label"] === "string") input.label = body["label"];
      if (typeof body["backend"] === "string") input.backend = body["backend"];
      if (typeof body["transport"] === "string") input.transport = body["transport"];
      if (typeof body["host"] === "string") input.host = body["host"];
      if (port !== undefined) input.port = port;
      if (body["capabilities"] && typeof body["capabilities"] === "object") {
        input.capabilities = body["capabilities"] as Record<string, unknown>;
      }
      if (body["metrics"] && typeof body["metrics"] === "object") {
        input.metrics = body["metrics"] as Record<string, unknown>;
      }
      const node = await manager.registerNode(input);
      return ctx.json({ node }, { status: 201 });
    } catch (error) {
      throw badRequest(error instanceof Error ? error.message : String(error));
    }
  });

  app.post("/distributed/nodes/:nodeId/heartbeat", async (ctx) => {
    const nodeId = ctx.req.param("nodeId");
    const body = await ctx.req.json().catch(() => ({}));
    const payload = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const heartbeatInput: HeartbeatInput = {};
    if (payload["metrics"] && typeof payload["metrics"] === "object") {
      heartbeatInput.metrics = payload["metrics"] as Record<string, unknown>;
    }
    if (typeof payload["status"] === "string") {
      heartbeatInput.status = payload["status"];
    }

    try {
      const node = await manager.heartbeat(nodeId, heartbeatInput);
      if (!node) {
        throw notFound(`Node not found: ${nodeId}`);
      }
      return ctx.json({ node });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Node not found:")) {
        throw notFound(error.message);
      }
      throw badRequest(error instanceof Error ? error.message : String(error));
    }
  });

  app.get("/distributed/nodes", (ctx) => {
    const nodes = manager.listNodes();
    return ctx.json({ nodes });
  });

  app.get("/distributed/allocations", (ctx) => {
    const modelId = ctx.req.query("model_id");
    const allocations = manager.listAllocations(modelId);
    return ctx.json({ allocations });
  });

  app.put("/distributed/allocations/:nodeId", async (ctx) => {
    const nodeId = ctx.req.param("nodeId");
    const body = await ctx.req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw badRequest("Invalid JSON payload");
    }
    const modelId = typeof body["model_id"] === "string" ? body["model_id"] : "";
    const startLayer = Number(body["start_layer"]);
    const endLayer = Number(body["end_layer"]);
    try {
      await manager.setAllocation(modelId, nodeId, startLayer, endLayer);
      return ctx.json({ success: true });
    } catch (error) {
      throw badRequest(error instanceof Error ? error.message : String(error));
    }
  });

  app.delete("/distributed/allocations/:nodeId", async (ctx) => {
    const nodeId = ctx.req.param("nodeId");
    const modelId = ctx.req.query("model_id");
    if (!modelId) {
      throw badRequest("model_id query parameter is required");
    }
    try {
      const deleted = await manager.clearAllocation(modelId, nodeId);
      if (!deleted) {
        throw notFound("Allocation not found");
      }
      return ctx.json({ success: true });
    } catch (error) {
      if (error instanceof Error && error.message === "Allocation not found") {
        throw notFound(error.message);
      }
      throw badRequest(error instanceof Error ? error.message : String(error));
    }
  });

  app.get("/distributed/topology/:modelId", (ctx) => {
    const modelId = ctx.req.param("modelId");
    const totalLayersRaw = ctx.req.query("total_layers");
    const totalLayers =
      totalLayersRaw === undefined || totalLayersRaw === ""
        ? null
        : Number.isInteger(Number(totalLayersRaw))
          ? Number(totalLayersRaw)
          : NaN;
    if (Number.isNaN(totalLayers)) {
      throw badRequest("total_layers must be an integer when provided");
    }
    return ctx.json({ topology: manager.getTopology(modelId, totalLayers) });
  });

  app.get("/distributed/status", (_ctx) => {
    return _ctx.json({ status: manager.getStatus() });
  });
};
