import { describe, expect, test } from "bun:test";
import {
  createTestApp,
  createTestHarness,
  registerControllerTestLifecycle,
} from "./fixtures";

registerControllerTestLifecycle();

const saveRecipe = async (
  app: { request: (path: string, init?: RequestInit) => Promise<Response> },
  recipeId: string,
  servedModelName: string,
): Promise<void> => {
  const response = await app.request("/recipes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: recipeId,
      name: `Recipe ${recipeId}`,
      backend: "vllm",
      model_path: `/models/${recipeId}`,
      served_model_name: servedModelName,
    }),
  });
  expect(response.status).toBe(200);
};

describe("instance registry", () => {
  test("pool parsing: valid ports are parsed from env", async () => {
    process.env.LOCAL_STUDIO_INSTANCE_PORTS = "8700-8702, 9000";
    const { context } = await createTestHarness();
    expect(context.config.instance_ports).toEqual([8700, 8701, 8702, 9000]);
  });

  test("pool parsing: malformed value yields empty array", async () => {
    process.env.LOCAL_STUDIO_INSTANCE_PORTS = "abc";
    const { context } = await createTestHarness();
    expect(context.config.instance_ports).toEqual([]);
  });

  test("pool parsing: filters out inference_port and controller port", async () => {
    process.env.LOCAL_STUDIO_INSTANCE_PORTS = "65534, 18080, 8700";
    const { context } = await createTestHarness();
    expect(context.config.instance_ports).toEqual([8700]);
  });

  test("reserve and release: allocates pool ports and blocks exhaustion", async () => {
    process.env.LOCAL_STUDIO_INSTANCE_PORTS = "8700,8701";
    const { context } = await createTestHarness();
    const registry = context.instanceRegistry;

    expect(registry.reserve("recipe-a")).toBe(8700);
    expect(registry.reserve("recipe-b")).toBe(8701);
    expect(registry.reserve("recipe-c")).toBeNull();

    registry.release("recipe-a");
    expect(registry.reserve("recipe-c")).toBe(8700);
  });

  test("duplicate reserve for same recipe returns null", async () => {
    process.env.LOCAL_STUDIO_INSTANCE_PORTS = "8700,8701";
    const { context } = await createTestHarness();
    const registry = context.instanceRegistry;

    expect(registry.reserve("recipe-a")).toBe(8700);
    expect(registry.reserve("recipe-a")).toBeNull();
  });

  test("dead-pid pruning: entries with dead pids are removed on access", async () => {
    process.env.LOCAL_STUDIO_INSTANCE_PORTS = "8700";
    const { context } = await createTestHarness();
    const registry = context.instanceRegistry;

    registry.reserve("recipe-a");
    registry.attachPid("recipe-a", 999999999);
    registry.markReady("recipe-a");

    expect(registry.list()).toEqual([]);
    expect(registry.reserve("recipe-b")).toBe(8700);
  });
});

describe("instance launch routes", () => {
  test("shared mode disabled when LOCAL_STUDIO_INSTANCE_PORTS is unset", async () => {
    const app = await createTestApp();
    await saveRecipe(app, "test-recipe", "test-model");

    const response = await app.request("/launch/test-recipe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "shared" }),
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.detail).toContain("LOCAL_STUDIO_INSTANCE_PORTS");
  });

  test("pool-exhausted 409 when all ports are in use", async () => {
    process.env.LOCAL_STUDIO_INSTANCE_PORTS = "8700";
    const { app, context } = await createTestHarness();
    await saveRecipe(app, "recipe-a", "model-a");
    await saveRecipe(app, "recipe-b", "model-b");

    context.instanceRegistry.reserve("recipe-a");
    context.instanceRegistry.attachPid("recipe-a", process.pid);
    context.instanceRegistry.markReady("recipe-a");

    const response = await app.request("/launch/recipe-b", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "shared" }),
    });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.detail).toContain("port pool exhausted");
  });

  test("already-an-instance 409 when recipe already has a live instance", async () => {
    process.env.LOCAL_STUDIO_INSTANCE_PORTS = "8700";
    const { app, context } = await createTestHarness();
    await saveRecipe(app, "recipe-a", "model-a");

    context.instanceRegistry.reserve("recipe-a");
    context.instanceRegistry.attachPid("recipe-a", process.pid);
    context.instanceRegistry.markReady("recipe-a");

    const response = await app.request("/launch/recipe-a", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "shared" }),
    });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.detail).toContain("already running as an instance");
  });

  test("GET /instances returns empty when no instances exist", async () => {
    process.env.LOCAL_STUDIO_INSTANCE_PORTS = "8700-8705";
    const { app } = await createTestHarness();

    const response = await app.request("/instances");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.instances).toEqual([]);
  });

  test("POST /instances/:recipeId/stop returns 404 for unknown recipe", async () => {
    process.env.LOCAL_STUDIO_INSTANCE_PORTS = "8700";
    const { app } = await createTestHarness();

    const response = await app.request("/instances/no-such-recipe/stop", {
      method: "POST",
    });
    expect(response.status).toBe(404);
  });

  test("GET /recipes shows instance-backed recipes as running", async () => {
    process.env.LOCAL_STUDIO_INSTANCE_PORTS = "8700";
    const { app, context } = await createTestHarness();
    await saveRecipe(app, "inst-recipe", "inst-model");

    context.instanceRegistry.reserve("inst-recipe");
    context.instanceRegistry.attachPid("inst-recipe", process.pid);
    context.instanceRegistry.markReady("inst-recipe");

    const response = await app.request("/recipes");
    expect(response.status).toBe(200);
    const recipes = await response.json();
    const found = recipes.find((r: { id: string }) => r.id === "inst-recipe");
    expect(found).toBeDefined();
    expect(found.status).toBe("running");
  });
});

describe("proxy routes to instance port", () => {
  test("chat completions routes to instance port for shared model", async () => {
    process.env.LOCAL_STUDIO_INSTANCE_PORTS = "8700";
    const { app, context } = await createTestHarness();

    const stub = Bun.serve({
      port: 8700,
      fetch() {
        return Response.json({
          id: "stub-completion",
          object: "chat.completion",
          choices: [{ message: { role: "assistant", content: "from instance" }, index: 0, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });
      },
    });

    try {
      await saveRecipe(app, "inst-model", "inst-model");

      context.instanceRegistry.reserve("inst-model");
      context.instanceRegistry.attachPid("inst-model", process.pid);
      context.instanceRegistry.markReady("inst-model");

      const response = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "inst-model",
          messages: [{ role: "user", content: "hello" }],
        }),
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.choices[0].message.content).toBe("from instance");
    } finally {
      stub.stop(true);
    }
  });

  test("chat completions returns 503 when no instance or primary model is running", async () => {
    const { app } = await createTestHarness();
    await saveRecipe(app, "unmatched-model", "unmatched-model");

    const response = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "unmatched-model",
        messages: [{ role: "user", content: "hello" }],
      }),
    });
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error.type).toBe("model_not_running");
  });
});
