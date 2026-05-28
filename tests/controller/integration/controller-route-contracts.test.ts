import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type EnvSnapshot = Record<string, string | undefined>;

const ENV_KEYS = [
  "VLLM_STUDIO_DATA_DIR",
  "VLLM_STUDIO_DB_PATH",
  "VLLM_STUDIO_MODELS_DIR",
  "VLLM_STUDIO_HOST",
  "VLLM_STUDIO_PORT",
  "VLLM_STUDIO_INFERENCE_PORT",
  "VLLM_STUDIO_MOCK_INFERENCE",
  "VLLM_STUDIO_MOCK_MODEL_ID",
  "VLLM_STUDIO_API_KEY",
  "VLLM_STUDIO_RUNTIME_SKIP_DOCKER",
  "VLLM_STUDIO_RUNTIME_SKIP_SYSTEM",
  "VLLM_STUDIO_LLAMA_BIN",
  "VLLM_STUDIO_MLX_PYTHON",
  "PI_CODING_AGENT_DIR",
] as const;

let envSnapshot: EnvSnapshot;
let tempDir: string;

type ControllerRequestRow = {
  method: string;
  path: string;
  status: number;
  duration_ms: number;
  success: number;
  error_class: string | null;
  error_message: string | null;
  user_agent: string | null;
};

type ControllerFunctionCallRow = {
  function_name: string;
  duration_ms: number;
  success: number;
  error_class: string | null;
  error_message: string | null;
};

beforeEach(() => {
  envSnapshot = Object.fromEntries(
    ENV_KEYS.map((key) => [key, process.env[key]]),
  );
  tempDir = mkdtempSync(join(tmpdir(), "vllm-studio-controller-test-"));
  Object.assign(process.env, {
    VLLM_STUDIO_DATA_DIR: tempDir,
    VLLM_STUDIO_DB_PATH: join(tempDir, "controller.db"),
    VLLM_STUDIO_MODELS_DIR: join(tempDir, "models"),
    VLLM_STUDIO_HOST: "127.0.0.1",
    VLLM_STUDIO_PORT: "18080",
    VLLM_STUDIO_INFERENCE_PORT: "65534",
    VLLM_STUDIO_MOCK_INFERENCE: "true",
    VLLM_STUDIO_MOCK_MODEL_ID: "mock-model",
    VLLM_STUDIO_RUNTIME_SKIP_DOCKER: "1",
    VLLM_STUDIO_RUNTIME_SKIP_SYSTEM: "1",
    PI_CODING_AGENT_DIR: join(tempDir, "pi-agent"),
  });
  delete process.env.VLLM_STUDIO_API_KEY;
});

afterEach(async () => {
  for (const key of ENV_KEYS) {
    const value = envSnapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
  rmSync(tempDir, { recursive: true, force: true });
});

async function createTestApp() {
  const { app } = await createTestHarness();
  return app;
}

async function createTestHarness() {
  const [{ createAppContext }, { createApp }] = await Promise.all([
    import("../../../controller/src/app-context"),
    import("../../../controller/src/http/app"),
  ]);
  const context = createAppContext();
  return { app: createApp(context), context };
}

function readControllerRequestRows(): ControllerRequestRow[] {
  const dbPath = process.env.VLLM_STUDIO_DB_PATH;
  if (!dbPath) throw new Error("VLLM_STUDIO_DB_PATH is required for tests");
  const db = new Database(dbPath, { readonly: true });
  try {
    return db
      .query<ControllerRequestRow, []>(
        `SELECT method, path, status, duration_ms, success, error_class, error_message, user_agent
         FROM controller_requests
         ORDER BY id ASC`,
      )
      .all();
  } finally {
    db.close();
  }
}

function readControllerFunctionCallRows(): ControllerFunctionCallRow[] {
  const dbPath = process.env.VLLM_STUDIO_DB_PATH;
  if (!dbPath) throw new Error("VLLM_STUDIO_DB_PATH is required for tests");
  const db = new Database(dbPath, { readonly: true });
  try {
    return db
      .query<ControllerFunctionCallRow, []>(
        `SELECT function_name, duration_ms, success, error_class, error_message
         FROM controller_function_calls
         ORDER BY id ASC`,
      )
      .all();
  } finally {
    db.close();
  }
}

async function collectSseJson(stream: ReadableStream<Uint8Array>) {
  const text = await new Response(stream).text();
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map(
      (line) =>
        JSON.parse(line.slice("data: ".length)) as Record<string, unknown>,
    );
}

describe("controller route contracts", () => {
  test("stream proxy keeps content with null tool_calls as answer text", async () => {
    const { createToolCallStream } =
      await import("../../../controller/src/modules/proxy/tool-call-stream");
    const encoder = new TextEncoder();
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              choices: [
                {
                  index: 0,
                  delta: {
                    content: "Let me inspect the file first.",
                    tool_calls: null,
                  },
                },
              ],
            })}\n\n`,
          ),
        );
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        id: "call-read",
                        index: 0,
                        type: "function",
                        function: { name: "read", arguments: "{}" },
                      },
                    ],
                  },
                },
              ],
            })}\n\n`,
          ),
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    const events = await collectSseJson(
      createToolCallStream(upstream.getReader()),
    );
    const firstEvent = events[0] as {
      choices?: Array<{ delta?: Record<string, unknown> }>;
    };
    const delta = firstEvent.choices?.[0]?.delta;

    expect(delta?.content).toBe("Let me inspect the file first.");
    expect(delta?.reasoning_content).toBeUndefined();
    const toolEvent = events[1] as {
      choices?: Array<{ delta?: Record<string, unknown> }>;
    };
    expect(toolEvent.choices?.[0]?.delta?.tool_calls).toEqual([
      expect.objectContaining({ id: "call-read" }),
    ]);
  });

  test("stream proxy keeps same-delta content visible when tool_calls are present", async () => {
    const { createToolCallStream } =
      await import("../../../controller/src/modules/proxy/tool-call-stream");
    const encoder = new TextEncoder();
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              choices: [
                {
                  index: 0,
                  delta: {
                    content: "Let me inspect the file first.",
                    tool_calls: [
                      {
                        id: "call-read",
                        index: 0,
                        type: "function",
                        function: { name: "read", arguments: "{}" },
                      },
                    ],
                  },
                },
              ],
            })}\n\n`,
          ),
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    const events = await collectSseJson(
      createToolCallStream(upstream.getReader()),
    );
    const firstEvent = events[0] as {
      choices?: Array<{ delta?: Record<string, unknown> }>;
    };
    const delta = firstEvent.choices?.[0]?.delta;

    expect(delta?.content).toBe("Let me inspect the file first.");
    expect(delta?.reasoning_content).toBeUndefined();
    expect(delta?.tool_calls).toEqual([
      expect.objectContaining({ id: "call-read" }),
    ]);
  });

  test("stream proxy splits implicit thinking close tags without duplicating answer text", async () => {
    const { createToolCallStream } =
      await import("../../../controller/src/modules/proxy/tool-call-stream");
    const encoder = new TextEncoder();
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              choices: [
                {
                  index: 0,
                  delta: {
                    content:
                      "I should inspect this first. </think>Here is the answer.",
                  },
                },
              ],
            })}\n\n`,
          ),
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    const events = await collectSseJson(
      createToolCallStream(upstream.getReader()),
    );
    const firstEvent = events[0] as {
      choices?: Array<{ delta?: Record<string, unknown> }>;
    };
    const delta = firstEvent.choices?.[0]?.delta;

    expect(delta?.content).toBe("Here is the answer.");
    expect(delta?.reasoning_content).toBe("I should inspect this first. ");
    expect(String(delta?.reasoning_content)).not.toContain("</think>");
    expect(String(delta?.reasoning_content)).not.toContain(
      "Here is the answer.",
    );
  });

  test("stream proxy buffers split implicit thinking until the close tag arrives", async () => {
    const { createToolCallStream } =
      await import("../../../controller/src/modules/proxy/tool-call-stream");
    const encoder = new TextEncoder();
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const content of [
          "I should inspect ",
          "this first. </think>",
          "Here is the answer.",
        ]) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                choices: [
                  {
                    index: 0,
                    delta: { content },
                  },
                ],
              })}\n\n`,
            ),
          );
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    const events = await collectSseJson(
      createToolCallStream(upstream.getReader(), undefined, undefined, {
        bufferImplicitReasoningContent: true,
      }),
    );
    const deltas = events.map((event) => {
      const choices = event["choices"] as
        | Array<{ delta?: Record<string, unknown> }>
        | undefined;
      return choices?.[0]?.delta ?? {};
    });

    expect(deltas).toEqual([
      {},
      { reasoning_content: "I should inspect this first. " },
      { content: "Here is the answer." },
    ]);
  });

  test("stream proxy still extracts XML tool calls after stripping visible content", async () => {
    const { createToolCallStream } =
      await import("../../../controller/src/modules/proxy/tool-call-stream");
    const encoder = new TextEncoder();
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              choices: [
                {
                  index: 0,
                  delta: {
                    content:
                      '<tool_call>{"name":"read","arguments":{"path":"package.json"}}</tool_call>',
                  },
                },
              ],
            })}\n\n`,
          ),
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    const events = await collectSseJson(
      createToolCallStream(upstream.getReader()),
    );
    const toolEvent = events.find((event) => {
      const choices = event["choices"];
      if (!Array.isArray(choices)) return false;
      const firstChoice = choices[0] as
        | { delta?: Record<string, unknown> }
        | undefined;
      return Array.isArray(firstChoice?.delta?.tool_calls);
    }) as { choices?: Array<{ delta?: Record<string, unknown> }> } | undefined;

    expect(toolEvent?.choices?.[0]?.delta?.tool_calls).toEqual([
      expect.objectContaining({
        type: "function",
        function: expect.objectContaining({
          name: "read",
          arguments: JSON.stringify({ path: "package.json" }),
        }),
      }),
    ]);
  });

  test("status route reports no active runtime on an isolated test port", async () => {
    const app = await createTestApp();
    const response = await app.request("/status");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      running: false,
      process: null,
      inference_port: 65534,
      launching: null,
    });

    expect(readControllerFunctionCallRows()).toEqual([
      expect.objectContaining({
        function_name: "status.findInferenceProcess",
        success: 1,
        error_class: null,
        error_message: null,
      }),
    ]);
  });

  test("mock inference exposes an OpenAI-compatible model list without a live backend", async () => {
    const app = await createTestApp();
    const response = await app.request("/v1/models");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.object).toBe("list");
    expect(body.data).toEqual([
      expect.objectContaining({
        id: "mock-model",
        object: "model",
        owned_by: "vllm-studio",
        active: true,
      }),
    ]);
  });

  test("model catalog routes expose recipe-backed model details and discovery metadata", async () => {
    const modelsDir = process.env.VLLM_STUDIO_MODELS_DIR;
    if (!modelsDir)
      throw new Error("VLLM_STUDIO_MODELS_DIR is required for tests");
    const modelPath = join(modelsDir, "catalog-route-model");
    mkdirSync(modelPath, { recursive: true });
    writeFileSync(
      join(modelPath, "config.json"),
      JSON.stringify({
        architectures: ["CatalogRouteForCausalLM"],
        max_position_embeddings: 8192,
      }),
      "utf8",
    );
    writeFileSync(join(modelPath, "model.safetensors"), "weights", "utf8");
    const app = await createTestApp();

    const createRecipeResponse = await app.request("/recipes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "catalog-route-recipe",
        name: "Catalog Route Recipe",
        model_path: modelPath,
        backend: "vllm",
        served_model_name: "catalog-route-served",
        max_model_len: 8192,
      }),
    });
    const createRecipeBody = await createRecipeResponse.json();
    expect(createRecipeResponse.status).toBe(200);
    expect(createRecipeBody).toEqual({
      success: true,
      id: "catalog-route-recipe",
    });

    const modelsResponse = await app.request("/v1/models");
    const modelsBody = await modelsResponse.json();
    expect(modelsResponse.status).toBe(200);
    expect(modelsBody).toMatchObject({ object: "list" });
    expect(modelsBody.data).toEqual([
      expect.objectContaining({
        id: "catalog-route-served",
        object: "model",
        owned_by: "vllm-studio",
        active: false,
        max_model_len: 8192,
      }),
    ]);

    const modelResponse = await app.request("/v1/models/catalog-route-served");
    const modelBody = await modelResponse.json();
    expect(modelResponse.status).toBe(200);
    expect(modelBody).toMatchObject({
      id: "catalog-route-served",
      object: "model",
      owned_by: "vllm-studio",
      active: false,
      max_model_len: 8192,
    });

    const missingModelResponse = await app.request("/v1/models/missing-model");
    const missingModelBody = await missingModelResponse.json();
    expect(missingModelResponse.status).toBe(404);
    expect(missingModelBody).toEqual({ detail: "Model not found" });

    const studioModelsResponse = await app.request("/v1/studio/models");
    const studioModelsBody = await studioModelsResponse.json();
    expect(studioModelsResponse.status).toBe(200);
    expect(studioModelsBody).toMatchObject({
      configured_models_dir: modelsDir,
    });
    expect(studioModelsBody.roots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: modelsDir,
          exists: true,
          sources: ["config", "recipe_parent"],
          recipe_ids: ["catalog-route-recipe"],
        }),
      ]),
    );
    expect(studioModelsBody.models).toEqual([
      expect.objectContaining({
        name: "catalog-route-model",
        path: modelPath,
        size_bytes: 7,
        architecture: "CatalogRouteForCausalLM",
        context_length: 8192,
        recipe_ids: ["catalog-route-recipe"],
        has_recipe: true,
      }),
    ]);

    const rows = readControllerRequestRows();
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "POST",
          path: "/recipes",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/v1/models",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/v1/models/catalog-route-served",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/v1/models/missing-model",
          status: 404,
          success: 0,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/v1/studio/models",
          status: 200,
          success: 1,
        }),
      ]),
    );

    expect(readControllerFunctionCallRows()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          function_name: "models.list.findInferenceProcess",
          success: 1,
          error_class: null,
          error_message: null,
        }),
        expect.objectContaining({
          function_name: "models.detail.findInferenceProcess",
          success: 1,
          error_class: null,
          error_message: null,
        }),
      ]),
    );
  });

  test("HuggingFace model search route normalizes list and exact-match results", async () => {
    const originalFetch = globalThis.fetch;
    const requestedUrls: string[] = [];
    globalThis.fetch = async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.startsWith("https://huggingface.co/api/models?")) {
        const params = new URL(url).searchParams;
        expect(params.get("search")).toBe("owner/model");
        expect(params.get("filter")).toBe("text-generation");
        expect(params.get("sort")).toBe("downloads");
        expect(params.get("limit")).toBe("3");
        return new Response(
          JSON.stringify([
            {
              id: "skip/model",
              downloads: 1,
              likes: 0,
              private: false,
              tags: [],
            },
            {
              id: "other/model",
              downloads: "12",
              likes: "3",
              private: false,
              tags: ["text-generation"],
            },
            {
              modelId: "owner/model",
              downloads: 5,
              likes: 2,
              private: false,
              tags: ["duplicate"],
            },
          ]),
          { headers: { "content-type": "application/json" } },
        );
      }
      if (url === "https://huggingface.co/api/models/owner/model") {
        return new Response(
          JSON.stringify({
            _id: "exact-id",
            modelId: "owner/model",
            downloads: 99,
            likes: 7,
            private: false,
            tags: ["exact"],
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ detail: "unexpected URL" }), {
        status: 500,
      });
    };

    try {
      const app = await createTestApp();
      const response = await app.request(
        "/v1/huggingface/models?search=owner/model&filter=text-generation&sort=downloads&limit=2&offset=1",
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(requestedUrls).toEqual(
        expect.arrayContaining([
          expect.stringContaining("https://huggingface.co/api/models?"),
          "https://huggingface.co/api/models/owner/model",
        ]),
      );
      expect(body).toEqual([
        expect.objectContaining({
          _id: "exact-id",
          modelId: "owner/model",
          downloads: 99,
          likes: 7,
          private: false,
          tags: ["exact"],
        }),
        expect.objectContaining({
          _id: "other/model",
          modelId: "other/model",
          downloads: 12,
          likes: 3,
          private: false,
          tags: ["text-generation"],
        }),
      ]);

      const rows = readControllerRequestRows();
      expect(rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            method: "GET",
            path: "/v1/huggingface/models",
            status: 200,
            success: 1,
          }),
        ]),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("invalid controller proxy targets fail before any upstream request is made", async () => {
    const app = await createTestApp();
    const response = await app.request(
      "/controllers/route/status?target=file:///etc/passwd",
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.detail).toBe("target must be an http(s) controller URL");
  });

  test("controller proxy forwards successful requests and records observability", async () => {
    const upstreamRequests: Array<{
      path: string;
      search: string;
      method: string;
      authorization: string | null;
    }> = [];
    const upstream = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        upstreamRequests.push({
          path: url.pathname,
          search: url.search,
          method: request.method,
          authorization: request.headers.get("authorization"),
        });
        return Response.json({
          ok: true,
          path: url.pathname,
          params: Object.fromEntries(url.searchParams.entries()),
        });
      },
    });

    try {
      const app = await createTestApp();
      const target = `http://127.0.0.1:${upstream.port}`;
      const response = await app.request(
        `/controllers/route/v1/models?target=${encodeURIComponent(target)}&limit=2`,
        { headers: { authorization: "Bearer proxy-test" } },
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(response.headers.get("x-vllm-routed-controller")).toBe(target);
      expect(body).toEqual({
        ok: true,
        path: "/v1/models",
        params: { limit: "2" },
      });
      expect(upstreamRequests).toEqual([
        {
          path: "/v1/models",
          search: "?limit=2",
          method: "GET",
          authorization: "Bearer proxy-test",
        },
      ]);

      const rows = readControllerRequestRows();
      expect(rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            method: "GET",
            path: "/controllers/route/v1/models",
            status: 200,
            success: 1,
          }),
        ]),
      );
    } finally {
      await upstream.stop(true);
    }
  });

  test("controller proxy forwards mutating request bodies and upstream statuses", async () => {
    const upstreamRequests: Array<{
      path: string;
      method: string;
      contentType: string | null;
      body: unknown;
    }> = [];
    const upstream = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        upstreamRequests.push({
          path: url.pathname,
          method: request.method,
          contentType: request.headers.get("content-type"),
          body: await request.json(),
        });
        return Response.json(
          {
            accepted: true,
            received: upstreamRequests.at(-1)?.body,
          },
          { status: 202 },
        );
      },
    });

    try {
      const app = await createTestApp();
      const target = `http://127.0.0.1:${upstream.port}`;
      const payload = {
        model: "mock-model",
        messages: [{ role: "user", content: "hi" }],
      };
      const response = await app.request(
        `/controllers/route/v1/chat/completions?target=${encodeURIComponent(target)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const body = await response.json();

      expect(response.status).toBe(202);
      expect(response.headers.get("x-vllm-routed-controller")).toBe(target);
      expect(body).toEqual({ accepted: true, received: payload });
      expect(upstreamRequests).toEqual([
        {
          path: "/v1/chat/completions",
          method: "POST",
          contentType: "application/json",
          body: payload,
        },
      ]);

      const rows = readControllerRequestRows();
      expect(rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            method: "POST",
            path: "/controllers/route/v1/chat/completions",
            status: 202,
            success: 1,
          }),
        ]),
      );
    } finally {
      await upstream.stop(true);
    }
  });

  test("vram calculator rejects malformed requests with structured errors", async () => {
    const app = await createTestApp();
    const response = await app.request("/vram-calculator", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ context_length: 0 }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.detail).toBe("model is required");
  });

  test("system introspection routes expose stable contracts and observability", async () => {
    const app = await createTestApp();

    const gpusResponse = await app.request("/gpus");
    const gpusBody = await gpusResponse.json();
    expect(gpusResponse.status).toBe(200);
    expect(typeof gpusBody.count).toBe("number");
    expect(Array.isArray(gpusBody.gpus)).toBe(true);
    expect(gpusBody.count).toBe(gpusBody.gpus.length);

    const compatResponse = await app.request("/compat");
    const compatBody = await compatResponse.json();
    expect(compatResponse.status).toBe(200);
    expect(compatBody.platform).toEqual(
      expect.objectContaining({ kind: expect.any(String) }),
    );
    expect(compatBody.gpu_monitoring).toEqual(
      expect.objectContaining({ available: expect.any(Boolean) }),
    );
    expect(compatBody.backends).toEqual(expect.any(Object));
    expect(Array.isArray(compatBody.checks)).toBe(true);

    const configResponse = await app.request("/config");
    const configBody = await configResponse.json();
    expect(configResponse.status).toBe(200);
    expect(configBody.config).toMatchObject({
      host: "127.0.0.1",
      port: 18080,
      inference_port: 65534,
      api_key_configured: false,
      models_dir: process.env.VLLM_STUDIO_MODELS_DIR,
      data_dir: tempDir,
      db_path: join(tempDir, "controller.db"),
    });
    expect(configBody.services).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Controller", status: "running" }),
        expect.objectContaining({
          name: "Inference runtime",
          status: "stopped",
        }),
        expect.objectContaining({ name: "Prometheus" }),
        expect.objectContaining({ name: "Frontend" }),
      ]),
    );
    expect(configBody.environment).toEqual(
      expect.objectContaining({
        controller_url: expect.any(String),
        inference_url: expect.any(String),
        frontend_url: expect.any(String),
      }),
    );
    expect(configBody.runtime).toEqual(expect.any(Object));

    const specResponse = await app.request("/api/spec");
    const specBody = await specResponse.json();
    expect(specResponse.status).toBe(200);
    expect(specBody).toMatchObject({
      openapi: "3.1.0",
      info: { title: "vLLM Studio API" },
    });
    expect(specBody.paths).toEqual(
      expect.objectContaining({
        "/status": expect.any(Object),
        "/config": expect.any(Object),
        "/compat": expect.any(Object),
      }),
    );

    const docsResponse = await app.request("/api/docs");
    const docsText = await docsResponse.text();
    expect(docsResponse.status).toBe(200);
    expect(docsText).toContain("/api/spec");

    const rows = readControllerRequestRows();
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "GET",
          path: "/gpus",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/compat",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/config",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/api/spec",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/api/docs",
          status: 200,
          success: 1,
        }),
      ]),
    );

    expect(readControllerFunctionCallRows()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          function_name: "compat.findInferenceProcess",
          success: 1,
          error_class: null,
          error_message: null,
        }),
        expect.objectContaining({
          function_name: "config.findInferenceProcess",
          success: 1,
          error_class: null,
          error_message: null,
        }),
      ]),
    );
  }, 15_000);

  test("studio settings and provider CRUD routes persist observable contracts", async () => {
    const app = await createTestApp();

    const settingsResponse = await app.request("/studio/settings");
    const settingsBody = await settingsResponse.json();
    expect(settingsResponse.status).toBe(200);
    expect(settingsBody.effective.models_dir).toBe(
      process.env.VLLM_STUDIO_MODELS_DIR,
    );

    const settingsUpdateResponse = await app.request("/studio/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ui_preferences: { theme: "midnight" } }),
    });
    const settingsUpdateBody = await settingsUpdateResponse.json();
    expect(settingsUpdateResponse.status).toBe(200);
    expect(settingsUpdateBody).toMatchObject({
      success: true,
      persisted: { ui_preferences: { theme: "midnight" } },
    });

    const providersResponse = await app.request("/studio/providers");
    const providersBody = await providersResponse.json();
    expect(providersResponse.status).toBe(200);
    expect(providersBody.providers).toEqual([]);

    const createProviderResponse = await app.request("/studio/providers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "local",
        name: "Local Provider",
        base_url: "http://127.0.0.1:8000",
        api_key: "secret-token",
        enabled: true,
      }),
    });
    const createProviderBody = await createProviderResponse.json();
    expect(createProviderResponse.status).toBe(200);
    expect(createProviderBody.provider).toEqual({
      id: "local",
      name: "Local Provider",
      base_url: "http://127.0.0.1:8000",
      enabled: true,
      has_api_key: true,
    });
    expect(createProviderBody.provider.api_key).toBeUndefined();

    const updateProviderResponse = await app.request(
      "/studio/providers/local",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Local Provider Updated",
          base_url: "http://127.0.0.1:9000",
          enabled: false,
        }),
      },
    );
    const updateProviderBody = await updateProviderResponse.json();
    expect(updateProviderResponse.status).toBe(200);
    expect(updateProviderBody.provider).toMatchObject({
      id: "local",
      name: "Local Provider Updated",
      base_url: "http://127.0.0.1:9000",
      enabled: false,
      has_api_key: true,
    });

    const deleteProviderResponse = await app.request(
      "/studio/providers/local",
      {
        method: "DELETE",
      },
    );
    const deleteProviderBody = await deleteProviderResponse.json();
    expect(deleteProviderResponse.status).toBe(200);
    expect(deleteProviderBody).toEqual({ success: true });

    const rows = readControllerRequestRows();
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "GET",
          path: "/studio/settings",
          status: 200,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/studio/settings",
          status: 200,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/studio/providers",
          status: 200,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/studio/providers",
          status: 200,
        }),
        expect.objectContaining({
          method: "PUT",
          path: "/studio/providers/local",
          status: 200,
        }),
        expect.objectContaining({
          method: "DELETE",
          path: "/studio/providers/local",
          status: 200,
        }),
      ]),
    );
    expect(rows.every((row) => row.success === 1)).toBe(true);
  });

  test("studio operational routes expose storage contracts and validate model file actions", async () => {
    const modelsDir = process.env.VLLM_STUDIO_MODELS_DIR;
    if (!modelsDir)
      throw new Error("VLLM_STUDIO_MODELS_DIR is required for tests");
    const modelPath = join(modelsDir, "studio-route-model");
    const targetRoot = join(modelsDir, "archive");
    const movedModelPath = join(targetRoot, "studio-route-model");
    mkdirSync(modelPath, { recursive: true });
    writeFileSync(
      join(modelPath, "config.json"),
      JSON.stringify({
        architectures: ["RouteTestForCausalLM"],
        max_position_embeddings: 4096,
      }),
      "utf8",
    );
    writeFileSync(join(modelPath, "model.safetensors"), "test", "utf8");
    const app = await createTestApp();

    const diagnosticsResponse = await app.request("/studio/diagnostics");
    const diagnosticsBody = await diagnosticsResponse.json();
    expect(diagnosticsResponse.status).toBe(200);
    expect(diagnosticsBody).toMatchObject({
      app_version: expect.any(String),
      platform: expect.any(String),
      arch: expect.any(String),
      release: expect.any(String),
      cpu_cores: expect.any(Number),
      config: {
        host: "127.0.0.1",
        port: 18080,
        inference_port: 65534,
        api_key_configured: false,
        models_dir: modelsDir,
        data_dir: tempDir,
        db_path: join(tempDir, "controller.db"),
      },
    });
    expect(Array.isArray(diagnosticsBody.gpus)).toBe(true);
    expect(Array.isArray(diagnosticsBody.disks)).toBe(true);

    const storageResponse = await app.request("/studio/storage");
    const storageBody = await storageResponse.json();
    expect(storageResponse.status).toBe(200);
    expect(storageBody).toMatchObject({
      models_dir: modelsDir,
      model_count: 1,
      model_bytes: 4,
      disk: { path: modelsDir },
    });

    const recommendationsResponse = await app.request(
      "/studio/recommendations",
    );
    const recommendationsBody = await recommendationsResponse.json();
    expect(recommendationsResponse.status).toBe(200);
    expect(Array.isArray(recommendationsBody.recommendations)).toBe(true);
    expect(typeof recommendationsBody.max_vram_gb).toBe("number");

    const providerModelsResponse = await app.request("/studio/provider-models");
    const providerModelsBody = await providerModelsResponse.json();
    expect(providerModelsResponse.status).toBe(200);
    expect(providerModelsBody).toEqual({ providers: [] });

    const missingDeletePathResponse = await app.request(
      "/studio/models/delete",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    const missingDeletePathBody = await missingDeletePathResponse.json();
    expect(missingDeletePathResponse.status).toBe(400);
    expect(missingDeletePathBody).toEqual({ detail: "path is required" });

    const outsideDeletePathResponse = await app.request(
      "/studio/models/delete",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: tempDir }),
      },
    );
    const outsideDeletePathBody = await outsideDeletePathResponse.json();
    expect(outsideDeletePathResponse.status).toBe(400);
    expect(outsideDeletePathBody).toEqual({
      detail: "path must be inside models_dir",
    });

    const missingMovePathResponse = await app.request("/studio/models/move", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const missingMovePathBody = await missingMovePathResponse.json();
    expect(missingMovePathResponse.status).toBe(400);
    expect(missingMovePathBody).toEqual({
      detail: "source_path and target_root are required",
    });

    const moveResponse = await app.request("/studio/models/move", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source_path: modelPath, target_root: targetRoot }),
    });
    const moveBody = await moveResponse.json();
    expect(moveResponse.status).toBe(200);
    expect(moveBody).toEqual({ success: true, target: movedModelPath });

    const deleteResponse = await app.request("/studio/models/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: movedModelPath }),
    });
    const deleteBody = await deleteResponse.json();
    expect(deleteResponse.status).toBe(200);
    expect(deleteBody).toEqual({ success: true });

    const rows = readControllerRequestRows();
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "GET",
          path: "/studio/diagnostics",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/studio/storage",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/studio/recommendations",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/studio/provider-models",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/studio/models/delete",
          status: 400,
          success: 0,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/studio/models/delete",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/studio/models/move",
          status: 400,
          success: 0,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/studio/models/move",
          status: 200,
          success: 1,
        }),
      ]),
    );
  }, 15_000);

  test("recipe CRUD routes persist success and not-found observability", async () => {
    const app = await createTestApp();
    const recipePayload = {
      id: "route-test-recipe",
      name: "Route Test Recipe",
      model_path: join(tempDir, "models", "route-test-model"),
      backend: "vllm",
      served_model_name: "route-test-model",
      tensor_parallel_size: 2,
      max_model_len: 8192,
      gpu_memory_utilization: 0.75,
      unknown_runtime_flag: "--example",
    };

    const createResponse = await app.request("/recipes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(recipePayload),
    });
    const createBody = await createResponse.json();
    expect(createResponse.status).toBe(200);
    expect(createBody).toEqual({ success: true, id: "route-test-recipe" });

    const listResponse = await app.request("/recipes");
    const listBody = await listResponse.json();
    expect(listResponse.status).toBe(200);
    expect(listBody).toEqual([
      expect.objectContaining({
        id: "route-test-recipe",
        name: "Route Test Recipe",
        backend: "vllm",
        served_model_name: "route-test-model",
        tensor_parallel_size: 2,
        max_model_len: 8192,
        status: "stopped",
        extra_args: { unknown_runtime_flag: "--example" },
      }),
    ]);

    const getResponse = await app.request("/recipes/route-test-recipe");
    const getBody = await getResponse.json();
    expect(getResponse.status).toBe(200);
    expect(getBody).toMatchObject({
      id: "route-test-recipe",
      name: "Route Test Recipe",
      gpu_memory_utilization: 0.75,
    });

    const updateResponse = await app.request("/recipes/route-test-recipe", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...recipePayload,
        name: "Updated Route Test Recipe",
        max_num_seqs: 16,
      }),
    });
    const updateBody = await updateResponse.json();
    expect(updateResponse.status).toBe(200);
    expect(updateBody).toEqual({ success: true, id: "route-test-recipe" });

    const updatedResponse = await app.request("/recipes/route-test-recipe");
    const updatedBody = await updatedResponse.json();
    expect(updatedResponse.status).toBe(200);
    expect(updatedBody).toMatchObject({
      id: "route-test-recipe",
      name: "Updated Route Test Recipe",
      max_num_seqs: 16,
    });

    const deleteResponse = await app.request("/recipes/route-test-recipe", {
      method: "DELETE",
    });
    const deleteBody = await deleteResponse.json();
    expect(deleteResponse.status).toBe(200);
    expect(deleteBody).toEqual({ success: true });

    const missingResponse = await app.request("/recipes/route-test-recipe");
    const missingBody = await missingResponse.json();
    expect(missingResponse.status).toBe(404);
    expect(missingBody).toEqual({ detail: "Recipe not found" });

    const rows = readControllerRequestRows();
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "POST",
          path: "/recipes",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/recipes",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/recipes/route-test-recipe",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "PUT",
          path: "/recipes/route-test-recipe",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "DELETE",
          path: "/recipes/route-test-recipe",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/recipes/route-test-recipe",
          status: 404,
          success: 0,
        }),
      ]),
    );

    expect(readControllerFunctionCallRows()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          function_name: "recipes.list.getCurrentProcess",
          success: 1,
          error_class: null,
          error_message: null,
        }),
      ]),
    );
  });

  test("engine lifecycle control routes expose no-op and missing-resource contracts", async () => {
    const app = await createTestApp();

    const missingLaunchResponse = await app.request("/launch/missing-recipe", {
      method: "POST",
    });
    const missingLaunchBody = await missingLaunchResponse.json();
    expect(missingLaunchResponse.status).toBe(404);
    expect(missingLaunchBody).toEqual({ detail: "Recipe not found" });

    const missingCancelResponse = await app.request(
      "/launch/missing-recipe/cancel",
      {
        method: "POST",
      },
    );
    const missingCancelBody = await missingCancelResponse.json();
    expect(missingCancelResponse.status).toBe(404);
    expect(missingCancelBody).toEqual({
      detail: "No launch in progress for missing-recipe",
    });

    const evictResponse = await app.request("/evict", { method: "POST" });
    const evictBody = await evictResponse.json();
    expect(evictResponse.status).toBe(200);
    expect(evictBody).toEqual({ success: true, evicted_pid: null });

    const waitReadyResponse = await app.request("/wait-ready?timeout=0");
    const waitReadyBody = await waitReadyResponse.json();
    expect(waitReadyResponse.status).toBe(200);
    expect(waitReadyBody).toEqual({
      ready: false,
      elapsed: 0,
      error: "Timeout waiting for backend",
    });

    const rows = readControllerRequestRows();
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "POST",
          path: "/launch/missing-recipe",
          status: 404,
          success: 0,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/launch/missing-recipe/cancel",
          status: 404,
          success: 0,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/evict",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/wait-ready",
          status: 200,
          success: 1,
        }),
      ]),
    );
  });

  test("runtime and download validation routes persist observable outcomes", async () => {
    const app = await createTestApp();

    const downloadsResponse = await app.request("/studio/downloads");
    const downloadsBody = await downloadsResponse.json();
    expect(downloadsResponse.status).toBe(200);
    expect(downloadsBody).toEqual({ downloads: [] });

    const missingDownloadResponse = await app.request(
      "/studio/downloads/missing-download",
    );
    const missingDownloadBody = await missingDownloadResponse.json();
    expect(missingDownloadResponse.status).toBe(404);
    expect(missingDownloadBody).toEqual({ detail: "Download not found" });

    const invalidDownloadResponse = await app.request("/studio/downloads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revision: "main" }),
    });
    const invalidDownloadBody = await invalidDownloadResponse.json();
    expect(invalidDownloadResponse.status).toBe(400);
    expect(invalidDownloadBody).toEqual({ detail: "model_id is required" });

    for (const action of ["pause", "resume", "cancel"]) {
      const response = await app.request(
        `/studio/downloads/missing-download/${action}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      const body = await response.json();
      expect(response.status).toBe(404);
      expect(body).toEqual({ detail: "Download not found" });
    }

    const runtimeTargetsResponse = await app.request("/runtime/targets");
    const runtimeTargetsBody = await runtimeTargetsResponse.json();
    expect(runtimeTargetsResponse.status).toBe(200);
    expect(Array.isArray(runtimeTargetsBody.targets)).toBe(true);

    const missingTargetResponse = await app.request(
      "/runtime/targets/missing-target",
    );
    const missingTargetBody = await missingTargetResponse.json();
    expect(missingTargetResponse.status).toBe(404);
    expect(missingTargetBody).toEqual({ detail: "Runtime target not found" });

    const invalidRuntimeJobResponse = await app.request("/runtime/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "update" }),
    });
    const invalidRuntimeJobBody = await invalidRuntimeJobResponse.json();
    expect(invalidRuntimeJobResponse.status).toBe(400);
    expect(invalidRuntimeJobBody).toEqual({ detail: "backend is required" });

    const invalidRuntimeBackendResponse = await app.request("/runtime/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ backend: "unknown", type: "update" }),
    });
    const invalidRuntimeBackendBody =
      await invalidRuntimeBackendResponse.json();
    expect(invalidRuntimeBackendResponse.status).toBe(400);
    expect(invalidRuntimeBackendBody).toEqual({ detail: "Invalid backend" });

    const invalidRuntimeJobTypeResponse = await app.request("/runtime/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ backend: "vllm", type: "restart" }),
    });
    const invalidRuntimeJobTypeBody =
      await invalidRuntimeJobTypeResponse.json();
    expect(invalidRuntimeJobTypeResponse.status).toBe(400);
    expect(invalidRuntimeJobTypeBody).toEqual({ detail: "Invalid job type" });

    const rows = readControllerRequestRows();
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "GET",
          path: "/studio/downloads",
          status: 200,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/studio/downloads/missing-download",
          status: 404,
          success: 0,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/studio/downloads",
          status: 400,
          success: 0,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/studio/downloads/missing-download/pause",
          status: 404,
          success: 0,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/studio/downloads/missing-download/resume",
          status: 404,
          success: 0,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/studio/downloads/missing-download/cancel",
          status: 404,
          success: 0,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/runtime/targets",
          status: 200,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/runtime/targets/missing-target",
          status: 404,
          success: 0,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/runtime/jobs",
          status: 400,
          success: 0,
        }),
      ]),
    );

    expect(readControllerFunctionCallRows()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          function_name: "runtime.targets.getCurrentProcess",
          success: 1,
          error_class: null,
          error_message: null,
        }),
        expect.objectContaining({
          function_name: "runtime.target.getCurrentProcess",
          success: 1,
          error_class: null,
          error_message: null,
        }),
      ]),
    );
  });

  test("runtime target selection and health routes persist observable outcomes", async () => {
    const llamaBin = join(tempDir, "llama-server-test");
    writeFileSync(
      llamaBin,
      [
        "#!/usr/bin/env sh",
        'if [ "$1" = "--version" ]; then echo \'llama-server test runtime\'; exit 0; fi',
        'if [ "$1" = "--help" ]; then echo \'usage: llama-server-test\'; exit 0; fi',
        "exit 0",
        "",
      ].join("\n"),
      "utf8",
    );
    chmodSync(llamaBin, 0o755);
    process.env.VLLM_STUDIO_LLAMA_BIN = llamaBin;
    const mlxPython = join(tempDir, "python-mlx-test");
    writeFileSync(
      mlxPython,
      [
        "#!/usr/bin/env sh",
        'if [ "$1" = "--version" ]; then echo \'Python 3.12.0\'; exit 0; fi',
        'if [ "$1" = "-c" ]; then echo \'{"version":"0.24.0","python":"\'"$0"\'"}\'; exit 0; fi',
        "exit 0",
        "",
      ].join("\n"),
      "utf8",
    );
    chmodSync(mlxPython, 0o755);
    process.env.VLLM_STUDIO_MLX_PYTHON = mlxPython;
    const app = await createTestApp();

    const targetsResponse = await app.request("/runtime/targets");
    const targetsBody = await targetsResponse.json();
    expect(targetsResponse.status).toBe(200);
    const target = targetsBody.targets.find(
      (candidate: Record<string, unknown>) =>
        candidate["backend"] === "llamacpp" &&
        candidate["source"] === "configured" &&
        candidate["binaryPath"] === llamaBin,
    );
    expect(target).toMatchObject({
      backend: "llamacpp",
      kind: "binary",
      source: "configured",
      installed: true,
      active: false,
      binaryPath: llamaBin,
      capabilities: expect.objectContaining({
        canLaunch: true,
        canInspectOptions: true,
      }),
      health: { status: "ok" },
    });
    if (!target)
      throw new Error("Expected configured llama.cpp runtime target");

    const mlxTarget = targetsBody.targets.find(
      (candidate: Record<string, unknown>) =>
        candidate["backend"] === "mlx" &&
        candidate["source"] === "configured" &&
        candidate["pythonPath"] === mlxPython,
    );
    expect(mlxTarget).toMatchObject({
      backend: "mlx",
      kind: "venv",
      source: "configured",
      installed: true,
      active: false,
      version: "0.24.0",
      pythonPath: mlxPython,
      capabilities: expect.objectContaining({
        canLaunch: true,
        canUpdate: false,
        canInspectOptions: false,
      }),
      health: { status: "ok" },
    });
    if (!mlxTarget) throw new Error("Expected configured MLX runtime target");

    const targetId = String(target.id);
    const targetResponse = await app.request(`/runtime/targets/${targetId}`);
    const targetBody = await targetResponse.json();
    expect(targetResponse.status).toBe(200);
    expect(targetBody.target).toMatchObject({
      id: targetId,
      backend: "llamacpp",
      binaryPath: llamaBin,
      health: { status: "ok" },
    });

    const healthResponse = await app.request(
      `/runtime/targets/${targetId}/health`,
    );
    const healthBody = await healthResponse.json();
    expect(healthResponse.status).toBe(200);
    expect(healthBody).toEqual({ health: { status: "ok" } });

    const selectResponse = await app.request(
      `/runtime/targets/${targetId}/select`,
      {
        method: "POST",
      },
    );
    const selectBody = await selectResponse.json();
    expect(selectResponse.status).toBe(200);
    expect(selectBody.target).toMatchObject({
      id: targetId,
      active: true,
      backend: "llamacpp",
    });

    const refreshedResponse = await app.request("/runtime/targets");
    const refreshedBody = await refreshedResponse.json();
    expect(refreshedResponse.status).toBe(200);
    expect(
      refreshedBody.targets.find(
        (candidate: Record<string, unknown>) => candidate["id"] === targetId,
      ),
    ).toMatchObject({ active: true });

    const mlxResponse = await app.request("/runtime/mlx");
    const mlxBody = await mlxResponse.json();
    expect(mlxResponse.status).toBe(200);
    expect(mlxBody).toMatchObject({
      installed: true,
      version: "0.24.0",
      python_path: mlxPython,
      upgrade_command_available: false,
    });

    const rows = readControllerRequestRows();
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "GET",
          path: "/runtime/targets",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: `/runtime/targets/${targetId}`,
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: `/runtime/targets/${targetId}/health`,
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "POST",
          path: `/runtime/targets/${targetId}/select`,
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/runtime/mlx",
          status: 200,
          success: 1,
        }),
      ]),
    );

    expect(readControllerFunctionCallRows()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          function_name: "runtime.targets.getCurrentProcess",
          success: 1,
          error_class: null,
          error_message: null,
        }),
        expect.objectContaining({
          function_name: "runtime.target.getCurrentProcess",
          success: 1,
          error_class: null,
          error_message: null,
        }),
        expect.objectContaining({
          function_name: "runtime.target.health.getCurrentProcess",
          success: 1,
          error_class: null,
          error_message: null,
        }),
        expect.objectContaining({
          function_name: "runtime.target.select.getCurrentProcess",
          success: 1,
          error_class: null,
          error_message: null,
        }),
      ]),
    );
  });

  test("runtime job lookup and config routes expose safe contracts without starting jobs", async () => {
    const app = await createTestApp();

    const jobsResponse = await app.request("/runtime/jobs");
    const jobsBody = await jobsResponse.json();
    expect(jobsResponse.status).toBe(200);
    expect(jobsBody).toEqual({ jobs: [] });

    const missingJobResponse = await app.request("/runtime/jobs/missing-job");
    const missingJobBody = await missingJobResponse.json();
    expect(missingJobResponse.status).toBe(404);
    expect(missingJobBody).toEqual({ detail: "Runtime job not found" });

    const missingCancelResponse = await app.request(
      "/runtime/jobs/missing-job/cancel",
      {
        method: "POST",
      },
    );
    const missingCancelBody = await missingCancelResponse.json();
    expect(missingCancelResponse.status).toBe(404);
    expect(missingCancelBody).toEqual({ detail: "Runtime job not found" });

    const mlxJobResponse = await app.request("/runtime/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ backend: "mlx", type: "update" }),
    });
    const mlxJobBody = await mlxJobResponse.json();
    expect(mlxJobResponse.status).toBe(200);
    expect(mlxJobBody.job).toMatchObject({
      backend: "mlx",
      type: "update",
    });

    const invalidArgsResponse = await app.request("/runtime/vllm/upgrade", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ args: ["--dry-run", 42] }),
    });
    const invalidArgsBody = await invalidArgsResponse.json();
    expect(invalidArgsResponse.status).toBe(400);
    expect(invalidArgsBody).toEqual({
      detail: "args must be an array of strings",
    });

    for (const route of [
      "/runtime/sglang/upgrade",
      "/runtime/llamacpp/upgrade",
      "/runtime/cuda/upgrade",
      "/runtime/rocm/upgrade",
    ]) {
      const response = await app.request(route, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ args: ["--dry-run", 42] }),
      });
      const body = await response.json();
      expect(response.status).toBe(400);
      expect(body).toEqual({ detail: "args must be an array of strings" });
    }

    const vllmConfigResponse = await app.request("/runtime/vllm/config");
    const vllmConfigBody = await vllmConfigResponse.json();
    expect(vllmConfigResponse.status).toBe(200);
    expect(vllmConfigBody).toEqual(expect.any(Object));

    const llamaConfigResponse = await app.request("/runtime/llamacpp/config");
    const llamaConfigBody = await llamaConfigResponse.json();
    expect(llamaConfigResponse.status).toBe(200);
    expect(llamaConfigBody).toEqual(expect.any(Object));

    const rows = readControllerRequestRows();
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "GET",
          path: "/runtime/jobs",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/runtime/jobs/missing-job",
          status: 404,
          success: 0,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/runtime/jobs/missing-job/cancel",
          status: 404,
          success: 0,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/runtime/jobs",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/runtime/vllm/upgrade",
          status: 400,
          success: 0,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/runtime/sglang/upgrade",
          status: 400,
          success: 0,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/runtime/llamacpp/upgrade",
          status: 400,
          success: 0,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/runtime/cuda/upgrade",
          status: 400,
          success: 0,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/runtime/rocm/upgrade",
          status: 400,
          success: 0,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/runtime/vllm/config",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/runtime/llamacpp/config",
          status: 200,
          success: 1,
        }),
      ]),
    );

    expect(readControllerFunctionCallRows()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          function_name: "runtime.jobs.getCurrentProcess",
          success: 1,
          error_class: null,
          error_message: null,
        }),
      ]),
    );
  }, 15_000);

  test("runtime backend metadata routes expose host-shaped contracts and observability", async () => {
    const app = await createTestApp();

    const vllmResponse = await app.request("/runtime/vllm");
    const vllmBody = await vllmResponse.json();
    expect(vllmResponse.status).toBe(200);
    expect(vllmBody).toMatchObject({
      installed: expect.any(Boolean),
      upgrade_command_available: expect.any(Boolean),
    });
    expect(
      vllmBody.version === null || typeof vllmBody.version === "string",
    ).toBe(true);
    expect(
      vllmBody.python_path === null || typeof vllmBody.python_path === "string",
    ).toBe(true);
    expect(
      vllmBody.vllm_bin === null || typeof vllmBody.vllm_bin === "string",
    ).toBe(true);

    const sglangResponse = await app.request("/runtime/sglang");
    const sglangBody = await sglangResponse.json();
    expect(sglangResponse.status).toBe(200);
    expect(sglangBody).toMatchObject({
      installed: expect.any(Boolean),
      upgrade_command_available: expect.any(Boolean),
    });
    expect(
      sglangBody.version === null || typeof sglangBody.version === "string",
    ).toBe(true);
    expect(
      sglangBody.python_path === null ||
        typeof sglangBody.python_path === "string",
    ).toBe(true);

    const llamaResponse = await app.request("/runtime/llamacpp");
    const llamaBody = await llamaResponse.json();
    expect(llamaResponse.status).toBe(200);
    expect(llamaBody).toMatchObject({
      installed: expect.any(Boolean),
      upgrade_command_available: expect.any(Boolean),
    });
    expect(
      llamaBody.version === null || typeof llamaBody.version === "string",
    ).toBe(true);
    expect(
      llamaBody.binary_path === null ||
        typeof llamaBody.binary_path === "string",
    ).toBe(true);

    const mlxResponse = await app.request("/runtime/mlx");
    const mlxBody = await mlxResponse.json();
    expect(mlxResponse.status).toBe(200);
    expect(mlxBody).toMatchObject({
      installed: expect.any(Boolean),
      upgrade_command_available: expect.any(Boolean),
    });
    expect(
      mlxBody.version === null || typeof mlxBody.version === "string",
    ).toBe(true);
    expect(
      mlxBody.python_path === null || typeof mlxBody.python_path === "string",
    ).toBe(true);

    const exllamav3Response = await app.request("/runtime/exllamav3");
    const exllamav3Body = await exllamav3Response.json();
    expect(exllamav3Response.status).toBe(200);
    expect(exllamav3Body).toMatchObject({
      installed: expect.any(Boolean),
      upgrade_command_available: expect.any(Boolean),
    });
    expect(
      exllamav3Body.version === null ||
        typeof exllamav3Body.version === "string",
    ).toBe(true);
    expect(
      exllamav3Body.binary_path === null ||
        typeof exllamav3Body.binary_path === "string",
    ).toBe(true);

    const cudaResponse = await app.request("/runtime/cuda");
    const cudaBody = await cudaResponse.json();
    expect(cudaResponse.status).toBe(200);
    expect(cudaBody).toMatchObject({
      upgrade_command_available: expect.any(Boolean),
    });
    expect(
      cudaBody.driver_version === null ||
        typeof cudaBody.driver_version === "string",
    ).toBe(true);
    expect(
      cudaBody.cuda_version === null ||
        typeof cudaBody.cuda_version === "string",
    ).toBe(true);

    const rocmResponse = await app.request("/runtime/rocm");
    const rocmBody = await rocmResponse.json();
    expect(rocmResponse.status).toBe(200);
    expect(rocmBody).toMatchObject({
      gpu_arch: expect.any(Array),
      upgrade_command_available: expect.any(Boolean),
    });
    expect(
      rocmBody.rocm_version === null ||
        typeof rocmBody.rocm_version === "string",
    ).toBe(true);
    expect(
      rocmBody.hip_version === null || typeof rocmBody.hip_version === "string",
    ).toBe(true);
    expect(
      rocmBody.smi_tool === null || typeof rocmBody.smi_tool === "string",
    ).toBe(true);

    const rows = readControllerRequestRows();
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "GET",
          path: "/runtime/vllm",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/runtime/sglang",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/runtime/llamacpp",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/runtime/mlx",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/runtime/exllamav3",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/runtime/cuda",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/runtime/rocm",
          status: 200,
          success: 1,
        }),
      ]),
    );

    expect(readControllerFunctionCallRows()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          function_name: "runtime.backend.sglang.getCurrentProcess",
          success: 1,
          error_class: null,
          error_message: null,
        }),
        expect.objectContaining({
          function_name: "runtime.backend.llamacpp.getCurrentProcess",
          success: 1,
          error_class: null,
          error_message: null,
        }),
        expect.objectContaining({
          function_name: "runtime.backend.mlx.getCurrentProcess",
          success: 1,
          error_class: null,
          error_message: null,
        }),
      ]),
    );
  }, 20_000);

  test("monitoring and log routes persist operational observability", async () => {
    const logsDir = join(tempDir, "logs");
    mkdirSync(logsDir, { recursive: true });
    writeFileSync(
      join(logsDir, "vllm_route-test.log"),
      "first line\nsecond line\n",
      "utf8",
    );
    const { app, context } = await createTestHarness();

    const prometheusResponse = await app.request("/metrics");
    const prometheusText = await prometheusResponse.text();
    expect(prometheusResponse.status).toBe(200);
    expect(prometheusResponse.headers.get("content-type")).toContain(
      "text/plain",
    );
    expect(prometheusText).toContain("vllm_studio");

    const currentMetricsResponse = await app.request("/v1/metrics/vllm");
    const currentMetricsBody = await currentMetricsResponse.json();
    expect(currentMetricsResponse.status).toBe(200);
    expect(currentMetricsBody).toMatchObject({
      model_id: null,
      model_path: null,
      served_model_name: null,
    });

    const peakMetricsResponse = await app.request("/peak-metrics");
    const peakMetricsBody = await peakMetricsResponse.json();
    expect(peakMetricsResponse.status).toBe(200);
    expect(peakMetricsBody).toEqual({ metrics: [] });

    const missingPeakResponse = await app.request(
      "/peak-metrics?model_id=missing-model",
    );
    const missingPeakBody = await missingPeakResponse.json();
    expect(missingPeakResponse.status).toBe(200);
    expect(missingPeakBody).toEqual({ error: "No metrics for this model" });

    const lifetimeResponse = await app.request("/lifetime-metrics");
    const lifetimeBody = await lifetimeResponse.json();
    expect(lifetimeResponse.status).toBe(200);
    expect(lifetimeBody).toMatchObject({
      tokens_total: 0,
      requests_total: 0,
      energy_wh: 0,
      current_power_watts: 0,
    });

    const benchmarkResponse = await app.request(
      "/benchmark?prompt_tokens=20&max_tokens=4",
      { method: "POST" },
    );
    const benchmarkBody = await benchmarkResponse.json();
    expect(benchmarkResponse.status).toBe(200);
    expect(benchmarkBody).toEqual({ error: "No model running" });

    const logsResponse = await app.request("/logs");
    const logsBody = await logsResponse.json();
    expect(logsResponse.status).toBe(200);
    expect(logsBody.sessions).toEqual([
      expect.objectContaining({
        id: "route-test",
        recipe_id: "route-test",
        model: "route-test",
        status: "stopped",
      }),
    ]);

    const logResponse = await app.request("/logs/route-test?limit=1");
    const logBody = await logResponse.json();
    expect(logResponse.status).toBe(200);
    expect(logBody).toEqual({
      id: "route-test",
      logs: ["second line"],
      content: "second line",
    });

    const streamController = new AbortController();
    const logStreamResponse = await app.request(
      "/logs/route-test/stream?tail=1",
      {
        signal: streamController.signal,
      },
    );
    expect(logStreamResponse.status).toBe(200);
    expect(logStreamResponse.headers.get("content-type")).toContain(
      "text/event-stream",
    );
    const logStreamReader = logStreamResponse.body?.getReader();
    expect(logStreamReader).toBeDefined();
    const logStreamChunk = await logStreamReader!.read();
    expect(logStreamChunk.done).toBe(false);
    const logStreamText = new TextDecoder().decode(logStreamChunk.value);
    expect(logStreamText).toContain("event: log");
    expect(logStreamText).toContain('"session_id":"route-test"');
    expect(logStreamText).toContain('"line":"second line"');
    streamController.abort();
    await logStreamReader!.cancel();

    const missingLogResponse = await app.request("/logs/missing-log");
    const missingLogBody = await missingLogResponse.json();
    expect(missingLogResponse.status).toBe(404);
    expect(missingLogBody).toEqual({ detail: "Log not found" });

    const controllerDeleteResponse = await app.request("/logs/controller", {
      method: "DELETE",
    });
    const controllerDeleteBody = await controllerDeleteResponse.json();
    expect(controllerDeleteResponse.status).toBe(400);
    expect(controllerDeleteBody).toEqual({
      detail: "controller logs cannot be deleted via API",
    });

    const eventStatsResponse = await app.request("/events/stats");
    const eventStatsBody = await eventStatsResponse.json();
    expect(eventStatsResponse.status).toBe(200);
    expect(eventStatsBody).toEqual({
      total_events_published: 0,
      channels: {},
      total_subscribers: 0,
    });

    const eventsController = new AbortController();
    const eventsResponse = await app.request("/events", {
      signal: eventsController.signal,
    });
    expect(eventsResponse.status).toBe(200);
    expect(eventsResponse.headers.get("content-type")).toContain(
      "text/event-stream",
    );
    const eventsReader = eventsResponse.body?.getReader();
    expect(eventsReader).toBeDefined();
    const eventsRead = eventsReader!.read();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await context.eventManager.publishStatus({
      running: false,
      source: "route-contract-test",
    });
    const eventsChunk = await eventsRead;
    expect(eventsChunk.done).toBe(false);
    const eventsText = new TextDecoder().decode(eventsChunk.value);
    expect(eventsText).toContain("event: status");
    expect(eventsText).toContain('"running":false');
    expect(eventsText).toContain('"source":"route-contract-test"');
    eventsController.abort();
    await eventsReader!.cancel();

    const rows = readControllerRequestRows();
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "GET",
          path: "/metrics",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/v1/metrics/vllm",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/peak-metrics",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/lifetime-metrics",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/benchmark",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/logs",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/logs/route-test",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/logs/route-test/stream",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/logs/missing-log",
          status: 404,
          success: 0,
        }),
        expect.objectContaining({
          method: "DELETE",
          path: "/logs/controller",
          status: 400,
          success: 0,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/events/stats",
          status: 200,
          success: 1,
        }),
      ]),
    );

    expect(readControllerFunctionCallRows()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          function_name: "metrics.prometheus.findInferenceProcess",
          success: 1,
          error_class: null,
          error_message: null,
        }),
        expect.objectContaining({
          function_name: "metrics.current.findInferenceProcess",
          success: 1,
          error_class: null,
          error_message: null,
        }),
        expect.objectContaining({
          function_name: "benchmark.findInferenceProcess",
          success: 1,
          error_class: null,
          error_message: null,
        }),
        expect.objectContaining({
          function_name: "logs.findInferenceProcess",
          success: 1,
          error_class: null,
          error_message: null,
        }),
      ]),
    );
  });

  test("proxy tokenization routes preserve fallbacks and observability without a live model", async () => {
    const app = await createTestApp();

    const tokenizeResponse = await app.request("/v1/tokenize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "mock-model", prompt: "hello world" }),
    });
    const tokenizeBody = await tokenizeResponse.json();
    expect(tokenizeResponse.status).toBe(200);
    expect(tokenizeBody).toEqual({ error: "No model running", num_tokens: 0 });

    const detokenizeResponse = await app.request("/v1/detokenize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "mock-model", tokens: [1, 2, 3] }),
    });
    const detokenizeBody = await detokenizeResponse.json();
    expect(detokenizeResponse.status).toBe(200);
    expect(detokenizeBody).toEqual({ error: "No model running", text: "" });

    const countTokensResponse = await app.request("/v1/count-tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "mock-model", text: "hello world" }),
    });
    const countTokensBody = await countTokensResponse.json();
    expect(countTokensResponse.status).toBe(200);
    expect(countTokensBody).toEqual({
      error: "No model running",
      num_tokens: 0,
    });

    const chatTokenizeResponse = await app.request(
      "/v1/tokenize-chat-completions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "mock-model",
          messages: [{ role: "user", content: "hello world" }],
        }),
      },
    );
    const chatTokenizeBody = await chatTokenizeResponse.json();
    expect(chatTokenizeResponse.status).toBe(200);
    expect(chatTokenizeBody).toEqual({
      error: "No model running",
      input_tokens: 0,
    });

    const titleResponse = await app.request("/api/title", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user: "Name this thread" }),
    });
    const titleBody = await titleResponse.json();
    expect(titleResponse.status).toBe(200);
    expect(titleBody).toEqual({ title: "New Chat" });

    const invalidChatResponse = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    const invalidChatBody = await invalidChatResponse.json();
    expect(invalidChatResponse.status).toBe(400);
    expect(invalidChatBody).toEqual({ detail: "Invalid JSON body" });

    const rows = readControllerRequestRows();
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "POST",
          path: "/v1/tokenize",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/v1/detokenize",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/v1/count-tokens",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/v1/tokenize-chat-completions",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/api/title",
          status: 200,
          success: 1,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/v1/chat/completions",
          status: 400,
          success: 0,
        }),
      ]),
    );

    expect(readControllerFunctionCallRows()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          function_name: "tokenize.findInferenceProcess",
          success: 1,
          error_class: null,
          error_message: null,
        }),
        expect.objectContaining({
          function_name: "detokenize.findInferenceProcess",
          success: 1,
          error_class: null,
          error_message: null,
        }),
        expect.objectContaining({
          function_name: "countTokens.findInferenceProcess",
          success: 1,
          error_class: null,
          error_message: null,
        }),
        expect.objectContaining({
          function_name: "tokenizeChatCompletions.findInferenceProcess",
          success: 1,
          error_class: null,
          error_message: null,
        }),
      ]),
    );
  });

  test("audio routes reject invalid requests with structured observable errors", async () => {
    const app = await createTestApp();

    const missingFileForm = new FormData();
    missingFileForm.set("model", "missing-stt-model");
    const missingFileResponse = await app.request("/v1/audio/transcriptions", {
      method: "POST",
      body: missingFileForm,
    });
    const missingFileBody = await missingFileResponse.json();
    expect(missingFileResponse.status).toBe(400);
    expect(missingFileBody).toEqual({
      code: "file_missing",
      error: "Multipart field 'file' is required",
    });

    const missingInputResponse = await app.request("/v1/audio/speech", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "missing-tts-model" }),
    });
    const missingInputBody = await missingInputResponse.json();
    expect(missingInputResponse.status).toBe(400);
    expect(missingInputBody).toEqual({
      code: "input_missing",
      error: "input is required and cannot be empty",
    });

    const unsupportedFormatResponse = await app.request("/v1/audio/speech", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        input: "Say hello",
        model: "missing-tts-model",
        response_format: "mp3",
      }),
    });
    const unsupportedFormatBody = await unsupportedFormatResponse.json();
    expect(unsupportedFormatResponse.status).toBe(400);
    expect(unsupportedFormatBody).toEqual({
      code: "unsupported_response_format",
      error: "Only response_format='wav' is supported",
    });

    const missingModelResponse = await app.request("/v1/audio/speech", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "Say hello" }),
    });
    const missingModelBody = await missingModelResponse.json();
    expect(missingModelResponse.status).toBe(400);
    expect(missingModelBody).toEqual({
      code: "model_missing",
      error: "No TTS model provided. Set model field or VLLM_STUDIO_TTS_MODEL.",
    });

    const rows = readControllerRequestRows();
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "POST",
          path: "/v1/audio/transcriptions",
          status: 400,
          success: 0,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/v1/audio/speech",
          status: 400,
          success: 0,
        }),
      ]),
    );
  });

  test("usage includes persisted controller route observability", async () => {
    const app = await createTestApp();

    await app.request("/status");
    await app.request("/v1/models");
    await app.request("/controllers/route/status?target=file:///etc/passwd");
    await app.request("/vram-calculator", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ context_length: 0 }),
    });

    const response = await app.request("/usage");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.controller.totals).toMatchObject({
      total_requests: 4,
      successful_requests: 2,
      failed_requests: 2,
      success_rate: 50,
    });
    expect(body.controller.latency.avg_ms).toBeGreaterThanOrEqual(0);
    expect(body.controller.latency.max_ms).toBeGreaterThanOrEqual(0);
    expect(body.controller.recent_activity).toMatchObject({
      last_hour_requests: 4,
      last_24h_requests: 4,
      last_24h_failed_requests: 2,
    });
    expect(body.controller.by_path).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "GET",
          path: "/status",
          requests: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/v1/models",
          requests: 1,
        }),
        expect.objectContaining({
          method: "GET",
          path: "/controllers/route/status",
          requests: 1,
          failed: 1,
        }),
        expect.objectContaining({
          method: "POST",
          path: "/vram-calculator",
          requests: 1,
          failed: 1,
        }),
      ]),
    );
    expect(body.controller.by_status).toEqual(
      expect.arrayContaining([
        { status: 200, requests: 2 },
        { status: 400, requests: 2 },
      ]),
    );
    expect(body.controller.recent_errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/vram-calculator", status: 400 }),
        expect.objectContaining({
          path: "/controllers/route/status",
          status: 400,
        }),
      ]),
    );
    expect(body.controller.function_calls.totals).toMatchObject({
      total_calls: 4,
      successful_calls: 4,
      failed_calls: 0,
      success_rate: 100,
    });
    expect(
      body.controller.function_calls.latency.avg_ms,
    ).toBeGreaterThanOrEqual(0);
    expect(
      body.controller.function_calls.latency.max_ms,
    ).toBeGreaterThanOrEqual(0);
    expect(body.controller.function_calls.by_function).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          function_name: "status.findInferenceProcess",
          calls: 1,
          successful: 1,
          failed: 0,
        }),
        expect.objectContaining({
          function_name: "models.list.findInferenceProcess",
          calls: 1,
          successful: 1,
          failed: 0,
        }),
        expect.objectContaining({
          function_name: "usage.collectKnownModels",
          calls: 1,
          successful: 1,
          failed: 0,
        }),
        expect.objectContaining({
          function_name: "usage.aggregateInferenceRequests",
          calls: 1,
          successful: 1,
          failed: 0,
        }),
      ]),
    );

    const functionRows = readControllerFunctionCallRows();
    expect(functionRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          function_name: "status.findInferenceProcess",
          success: 1,
          error_class: null,
          error_message: null,
        }),
        expect.objectContaining({
          function_name: "models.list.findInferenceProcess",
          success: 1,
          error_class: null,
          error_message: null,
        }),
        expect.objectContaining({
          function_name: "usage.collectKnownModels",
          success: 1,
          error_class: null,
          error_message: null,
        }),
        expect.objectContaining({
          function_name: "usage.aggregateInferenceRequests",
          success: 1,
          error_class: null,
          error_message: null,
        }),
      ]),
    );
  });

  test("usage still returns controller observability when inference aggregation fails", async () => {
    const [{ createAppContext }, { createApp }] = await Promise.all([
      import("../../../controller/src/app-context"),
      import("../../../controller/src/http/app"),
    ]);
    const context = createAppContext();
    const aggregate = context.stores.inferenceRequestStore.aggregate.bind(
      context.stores.inferenceRequestStore,
    );
    context.stores.inferenceRequestStore.aggregate = () => {
      throw new Error("forced aggregate failure");
    };
    const app = createApp(context);

    await app.request("/status");

    const response = await app.request("/usage");
    const body = await response.json();

    context.stores.inferenceRequestStore.aggregate = aggregate;

    expect(response.status).toBe(200);
    expect(body.totals).toMatchObject({
      total_requests: 0,
      successful_requests: 0,
      failed_requests: 0,
    });
    expect(body.controller.totals).toMatchObject({
      total_requests: 1,
      successful_requests: 1,
      failed_requests: 0,
      success_rate: 100,
    });
    expect(body.controller.by_path).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: "GET",
          path: "/status",
          requests: 1,
          successful: 1,
          failed: 0,
        }),
      ]),
    );
    expect(body.controller.function_calls.totals).toMatchObject({
      total_calls: 3,
      successful_calls: 2,
      failed_calls: 1,
    });
    expect(body.controller.function_calls.totals.success_rate).toBeCloseTo(
      66.666,
      2,
    );
    expect(body.controller.function_calls.recent_errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          function_name: "usage.aggregateInferenceRequests",
          error_class: "Error",
          error_message: "forced aggregate failure",
        }),
      ]),
    );

    const functionRows = readControllerFunctionCallRows();
    expect(functionRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          function_name: "status.findInferenceProcess",
          success: 1,
          error_class: null,
          error_message: null,
        }),
        expect.objectContaining({
          function_name: "usage.collectKnownModels",
          success: 1,
          error_class: null,
          error_message: null,
        }),
        expect.objectContaining({
          function_name: "usage.aggregateInferenceRequests",
          success: 0,
          error_class: "Error",
          error_message: "forced aggregate failure",
        }),
      ]),
    );
  });

  test("pi-sessions usage route aggregates Pi JSONL session usage", async () => {
    const piDir = process.env.PI_CODING_AGENT_DIR;
    if (!piDir) throw new Error("PI_CODING_AGENT_DIR is required for tests");
    const sessionDir = join(piDir, "sessions", "personal");
    mkdirSync(sessionDir, { recursive: true });
    const timestamp = new Date().toISOString();
    writeFileSync(
      join(sessionDir, "session.jsonl"),
      [
        JSON.stringify({ type: "session", id: "pi-session-1" }),
        JSON.stringify({ type: "model_change", modelId: "deepseek-v4-flash" }),
        JSON.stringify({
          type: "message",
          timestamp,
          message: {
            role: "assistant",
            timestamp,
            usage: {
              input: 11,
              output: 7,
              totalTokens: 18,
              cacheRead: 5,
              cacheWrite: 3,
            },
          },
        }),
      ].join("\n"),
      "utf8",
    );
    const app = await createTestApp();

    const response = await app.request("/usage/pi-sessions");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.totals).toMatchObject({
      total_tokens: 18,
      prompt_tokens: 11,
      completion_tokens: 7,
      total_requests: 1,
      successful_requests: 1,
      failed_requests: 0,
      unique_sessions: 1,
    });
    expect(body.cache).toMatchObject({
      hits: 1,
      misses: 1,
      hit_tokens: 5,
      miss_tokens: 3,
      hit_rate: 50,
    });
    expect(body.recent_activity).toMatchObject({
      last_hour_requests: 1,
      last_24h_requests: 1,
      last_24h_tokens: 18,
    });
    expect(body.by_model).toEqual([
      expect.objectContaining({
        model: "deepseek-v4-flash",
        requests: 1,
        total_tokens: 18,
        prompt_tokens: 11,
        completion_tokens: 7,
        success_rate: 100,
      }),
    ]);

    const functionRows = readControllerFunctionCallRows();
    expect(functionRows).toEqual([
      expect.objectContaining({
        function_name: "usage.aggregatePiSessions",
        success: 1,
        error_class: null,
        error_message: null,
      }),
    ]);
    expect(functionRows[0].duration_ms).toBeGreaterThanOrEqual(0);
  });

  test("controller observability persists normalized raw rows for every route action", async () => {
    const app = await createTestApp();

    await app.request("/status?ignored=1", {
      headers: { "user-agent": "controller-integration-test/1.0" },
    });
    await app.request("/missing-route");
    await app.request("/vram-calculator", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "controller-integration-test/1.0",
      },
      body: JSON.stringify({ context_length: 0 }),
    });

    const rows = readControllerRequestRows();

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      method: "GET",
      path: "/status",
      status: 200,
      success: 1,
      error_class: null,
      error_message: null,
      user_agent: "controller-integration-test/1.0",
    });
    expect(rows[0].duration_ms).toBeGreaterThanOrEqual(0);
    expect(rows[1]).toMatchObject({
      method: "GET",
      path: "/missing-route",
      status: 404,
      success: 0,
      error_class: null,
      error_message: null,
    });
    expect(rows[2]).toMatchObject({
      method: "POST",
      path: "/vram-calculator",
      status: 400,
      success: 0,
      error_class: null,
      error_message: null,
      user_agent: "controller-integration-test/1.0",
    });
  });
});
