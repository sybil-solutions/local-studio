import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  createTestApp,
  readControllerFunctionCallRows,
  readControllerRequestRows,
  registerControllerTestLifecycle,
} from "./fixtures";

registerControllerTestLifecycle();

describe("controller route contracts", () => {
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
        owned_by: "local-studio",
        active: true,
      }),
    ]);
  });

  test("model catalog routes expose recipe-backed model details and discovery metadata", async () => {
    const modelsDir = process.env.LOCAL_STUDIO_MODELS_DIR;
    if (!modelsDir)
      throw new Error("LOCAL_STUDIO_MODELS_DIR is required for tests");
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
        owned_by: "local-studio",
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
      owned_by: "local-studio",
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

  test("HuggingFace model search route forwards createdAt sorting", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (!url.startsWith("https://huggingface.co/api/models?")) {
        return new Response(JSON.stringify({ detail: "unexpected URL" }), {
          status: 500,
        });
      }

      const params = new URL(url).searchParams;
      expect(params.get("filter")).toBe("text-generation");
      expect(params.get("sort")).toBe("createdAt");
      expect(params.get("limit")).toBe("5");
      return new Response(
        JSON.stringify([
          {
            id: "fresh/model",
            createdAt: "2026-06-05T00:00:00.000Z",
            downloads: 0,
            likes: 0,
            private: false,
            tags: ["text-generation"],
          },
        ]),
        { headers: { "content-type": "application/json" } },
      );
    };

    try {
      const app = await createTestApp();
      const response = await app.request(
        "/v1/huggingface/models?filter=text-generation&sort=createdAt&limit=5",
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual([
        expect.objectContaining({
          _id: "fresh/model",
          modelId: "fresh/model",
          createdAt: "2026-06-05T00:00:00.000Z",
        }),
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("HuggingFace model search route preserves omitted sort for relevance", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (!url.startsWith("https://huggingface.co/api/models?")) {
        return new Response(JSON.stringify({ detail: "unexpected URL" }), {
          status: 500,
        });
      }

      const params = new URL(url).searchParams;
      expect(params.get("search")).toBe("llama");
      expect(params.get("sort")).toBeNull();
      expect(params.get("limit")).toBe("1");
      return new Response(
        JSON.stringify([
          {
            id: "relevant/model",
            downloads: 10,
            likes: 2,
            private: false,
            tags: ["text-generation"],
          },
        ]),
        { status: 200 },
      );
    };

    try {
      const app = await createTestApp();
      const response = await app.request(
        "/v1/huggingface/models?search=llama&limit=1",
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual([
        expect.objectContaining({
          _id: "relevant/model",
          modelId: "relevant/model",
        }),
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
