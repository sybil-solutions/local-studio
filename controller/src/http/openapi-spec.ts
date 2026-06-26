import type { AppContext } from "../app-context";

export const createOpenApiSpec = (context: AppContext): Record<string, unknown> => ({
  openapi: "3.1.0",
  info: {
    title: "Local Studio API",
    version: "0.3.2",
    description: "Model lifecycle management for vLLM, SGLang, and TabbyAPI inference servers",
  },
  servers: [
    {
      url: `http://localhost:${context.config.port}`,
      description: "Local development server",
    },
  ],
  paths: {
    "/status": {
      get: {
        summary: "Get status",
        description: "Get current status of the inference backend",
        responses: {
          "200": {
            description: "Status information",
          },
        },
      },
    },
    "/gpus": {
      get: {
        summary: "List GPUs",
        description: "Get GPU information including memory, utilization, temperature",
        responses: {
          "200": {
            description: "GPU list",
          },
        },
      },
    },
    "/config": {
      get: {
        summary: "System configuration",
        description: "Get controller config, service status, environment URLs, and runtime details",
        responses: {
          "200": {
            description: "System configuration payload",
          },
        },
      },
    },
    "/compat": {
      get: {
        summary: "Compatibility report",
        description: "Get platform/runtime/tooling checks with actionable fixes",
        responses: {
          "200": {
            description: "Compatibility report",
          },
        },
      },
    },
    "/runtime/vllm": {
      get: {
        summary: "vLLM runtime info",
        description: "Get vLLM version, install status, and python path",
        responses: {
          "200": {
            description: "Runtime info",
          },
        },
      },
    },
    "/runtime/vllm/config": {
      get: {
        summary: "vLLM runtime config",
        description: "Get vLLM launch and dependency configuration help",
        responses: {
          "200": {
            description: "Runtime config",
          },
        },
      },
    },
    "/runtime/sglang": {
      get: {
        summary: "SGLang runtime info",
        description: "Get SGLang version and python runtime path",
        responses: {
          "200": {
            description: "Runtime info",
          },
        },
      },
    },
    "/runtime/llamacpp": {
      get: {
        summary: "llama.cpp runtime info",
        description: "Get llama.cpp install status and binary/version",
        responses: {
          "200": {
            description: "Runtime info",
          },
        },
      },
    },
    "/runtime/mlx": {
      get: {
        summary: "MLX runtime info",
        description: "Get MLX install status and Python runtime path",
        responses: {
          "200": {
            description: "Runtime info",
          },
        },
      },
    },
    "/runtime/cuda": {
      get: {
        summary: "CUDA info",
        description: "Get NVIDIA driver and CUDA version information",
        responses: {
          "200": {
            description: "Runtime info",
          },
        },
      },
    },
    "/runtime/rocm": {
      get: {
        summary: "ROCm info",
        description: "Get ROCm/HIP version and tool information",
        responses: {
          "200": {
            description: "Runtime info",
          },
        },
      },
    },
    "/runtime/vllm/upgrade": {
      post: {
        summary: "Upgrade vLLM runtime",
        description: "Trigger vLLM runtime upgrade",
        responses: {
          "200": {
            description: "Upgrade result",
          },
        },
      },
    },
    "/runtime/sglang/upgrade": {
      post: {
        summary: "Upgrade SGLang runtime",
        description: "Trigger SGLang runtime upgrade",
        responses: {
          "200": {
            description: "Upgrade result",
          },
        },
      },
    },
    "/runtime/llamacpp/upgrade": {
      post: {
        summary: "Upgrade llama.cpp runtime",
        description: "Run llama.cpp upgrade command",
        responses: {
          "200": {
            description: "Upgrade result",
          },
        },
      },
    },
    "/runtime/cuda/upgrade": {
      post: {
        summary: "Upgrade CUDA stack",
        description: "Run configured CUDA upgrade command",
        responses: {
          "200": {
            description: "Upgrade result",
          },
        },
      },
    },
    "/runtime/rocm/upgrade": {
      post: {
        summary: "Upgrade ROCm stack",
        description: "Run configured ROCm upgrade command",
        responses: {
          "200": {
            description: "Upgrade result",
          },
        },
      },
    },
    "/recipes": {
      get: {
        summary: "List recipes",
        description: "Get all model launch recipes",
        responses: {
          "200": {
            description: "Recipe list",
          },
        },
      },
      post: {
        summary: "Create recipe",
        description: "Create a new model launch recipe",
        responses: {
          "201": {
            description: "Recipe created",
          },
        },
      },
    },
    "/evict": {
      post: {
        summary: "Evict running model",
        description: "Stop the active inference process",
        responses: {
          "200": {
            description: "Eviction result",
          },
        },
      },
    },
    "/launch/{recipe_id}": {
      post: {
        summary: "Launch model",
        description: "Launch a model from a recipe",
        parameters: [
          {
            name: "recipe_id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Model launched",
          },
        },
      },
    },
    "/lifetime-metrics": {
      get: {
        summary: "Lifetime metrics",
        description: "Get cumulative token/request/energy counters used by the CLI dashboard",
        responses: {
          "200": {
            description: "Lifetime metrics payload",
          },
        },
      },
    },
  },
});
