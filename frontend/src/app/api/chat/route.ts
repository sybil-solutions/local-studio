// CRITICAL
import { streamText, jsonSchema, convertToModelMessages } from "ai";
import type { UIMessage, ToolSet } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { getApiSettings } from "@/lib/api-settings";

// Allow streaming responses up to 5 minutes
export const maxDuration = 300;

interface ToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface PostBody {
  messages: UIMessage[];
  model?: string;
  tools?: ToolDefinition[];
  system?: string;
}

function getClientInfo(req: Request) {
  const ip =
    req.headers.get("CF-Connecting-IP") ||
    req.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    req.headers.get("X-Real-IP") ||
    "unknown";
  const country = req.headers.get("CF-IPCountry") || "-";
  return { ip, country };
}

export async function POST(req: Request) {
  const client = getClientInfo(req);

  try {
    const body: PostBody = await req.json();
    const { messages, model, tools, system } = body;
    const resolvedModel = model || "default";

    const toolNames = (tools || []).map((tool) => tool.name).join(", ");
    console.log(
      `[CHAT] ip=${client.ip} | country=${client.country} | model=${resolvedModel} | messages=${messages?.length || 0} | tools=${tools?.length || 0} | systemLength=${system?.length || 0}`,
    );
    if (toolNames) {
      console.log(`[CHAT] tools=[${toolNames}]`);
    }

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "Messages required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Get dynamic settings
    const settings = await getApiSettings();
    const BACKEND_URL = settings.backendUrl;
    const API_KEY = settings.apiKey;

    // Create OpenAI-compatible client for vLLM/LiteLLM
    const openaiCompatible = createOpenAICompatible({
      name: "vllm-studio",
      baseURL: `${BACKEND_URL}/v1`,
      apiKey: API_KEY || "sk-master",
    });

    const modelInstance = openaiCompatible(resolvedModel);

    // Build tool set with model-only schemas (no server execution)
    // Tools will be emitted to client for execution via onToolCall
    const toolSet = (tools || []).reduce<
      Record<string, { description?: string; inputSchema: unknown }>
    >((acc, tool) => {
      acc[tool.name] = {
        description: tool.description,
        inputSchema: jsonSchema(tool.inputSchema || { type: "object", properties: {} }),
      };
      return acc;
    }, {});

    // Convert UIMessages to model messages using the SDK helper
    const modelMessages = await convertToModelMessages(messages);

    const result = streamText({
      model: modelInstance,
      messages: modelMessages,
      system: system?.trim() || undefined,
      tools: toolSet as unknown as ToolSet,
      temperature: 0.7,
      onChunk: ({ chunk }) => {
        if (chunk.type === "reasoning-delta") {
          console.log(`[CHAT] ip=${client.ip} | reasoning_delta`);
        } else if (chunk.type === "text-delta") {
          console.log(`[CHAT] ip=${client.ip} | text_delta=${chunk.text.length}`);
        }
      },
    });

    // Return the UI message stream response
    return result.toUIMessageStreamResponse({
      sendReasoning: true,
      messageMetadata: ({ part }) => {
        if (part.type === "start") {
          return { model: resolvedModel };
        }
        if (part.type === "finish") {
          return {
            model: resolvedModel,
            usage: part.totalUsage,
          };
        }
        return undefined;
      },
      onError: (error) => {
        if (error == null) return "Unknown error";
        if (typeof error === "string") return error;
        if (error instanceof Error) return error.message;
        return JSON.stringify(error);
      },
    });
  } catch (error) {
    console.error(
      `[CHAT ERROR] ip=${client.ip} | country=${client.country} | error=${String(error)}`,
    );
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
