// CRITICAL
import type { AppContext } from "../types/context";

export const createOpenApiSpec = (context: AppContext): Record<string, unknown> => ({
  openapi: "3.1.0",
  info: {
    title: "vLLM Studio API",
    version: "0.3.1",
    description: "Model lifecycle management for vLLM, SGLang, and TabbyAPI inference servers",
  },
  servers: [
    {
      url: `http://localhost:${context.config.port}`,
      description: "Local development server",
    },
  ],
  paths: {
    "/health": {
      get: {
        summary: "Health check",
        description: "Check if the controller and inference backend are healthy",
        responses: {
          "200": {
            description: "Service is healthy",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", enum: ["ok"] },
                    version: { type: "string" },
                    inference_ready: { type: "boolean" },
                    backend_reachable: { type: "boolean" },
                    running_model: { type: ["string", "null"] },
                  },
                },
              },
            },
          },
        },
      },
    },
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
    "/chats": {
      get: {
        summary: "List chat sessions",
        responses: {
          "200": {
            description: "Chat list",
          },
        },
      },
      post: {
        summary: "Create chat session",
        responses: {
          "201": {
            description: "Chat created",
          },
        },
      },
    },
    "/distributed/nodes/register": {
      post: {
        summary: "Register distributed node",
        description: "Register or update a node that can host model layers",
        responses: {
          "201": {
            description: "Node registered",
          },
        },
      },
    },
    "/distributed/nodes": {
      get: {
        summary: "List distributed nodes",
        description: "List all registered distributed nodes and current heartbeat state",
        responses: {
          "200": {
            description: "Node list",
          },
        },
      },
    },
    "/distributed/nodes/{node_id}/heartbeat": {
      post: {
        summary: "Distributed heartbeat",
        description: "Update heartbeat/metrics for a registered node",
        parameters: [
          {
            name: "node_id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Heartbeat accepted",
          },
          "404": {
            description: "Node not found",
          },
        },
      },
    },
    "/distributed/allocations": {
      get: {
        summary: "List manual layer allocations",
        description: "List all manual allocations, optionally filtered by model_id",
        responses: {
          "200": {
            description: "Allocation list",
          },
        },
      },
    },
    "/distributed/allocations/{node_id}": {
      put: {
        summary: "Assign manual layer range",
        description: "Set manual [start_layer, end_layer) for one model/node pair",
        parameters: [
          {
            name: "node_id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Allocation updated",
          },
        },
      },
      delete: {
        summary: "Clear manual layer range",
        description: "Delete manual layer allocation for one model/node pair",
        parameters: [
          {
            name: "node_id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Allocation removed",
          },
        },
      },
    },
    "/distributed/topology/{model_id}": {
      get: {
        summary: "Validate model topology",
        description: "Inspect gaps/overlaps across manual layer assignments",
        parameters: [
          {
            name: "model_id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Topology report",
          },
        },
      },
    },
    "/distributed/status": {
      get: {
        summary: "Get distributed cluster status",
        description: "Return a summary of online/stale nodes and model coverage",
        responses: {
          "200": {
            description: "Distributed cluster status",
          },
        },
      },
    },
  },
});
