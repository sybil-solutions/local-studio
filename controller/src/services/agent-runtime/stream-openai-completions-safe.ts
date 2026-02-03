// CRITICAL
import {
  parseStreamingJson,
  streamSimple,
} from "@mariozechner/pi-ai";
import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Model,
  SimpleStreamOptions,
  ToolCall,
} from "@mariozechner/pi-ai";
import { createAssistantMessageEventStream } from "@mariozechner/pi-ai/dist/utils/event-stream.js";
import type { StreamFn } from "@mariozechner/pi-agent-core";

type ToolCallWithPartialArguments = ToolCall & { partialArgs?: string };
type AssistantStream = ReturnType<typeof streamSimple>;

const isToolCallParseError = (message: AssistantMessage): boolean => {
  if (!message.errorMessage) {
    return false;
  }
  const lower = message.errorMessage.toLowerCase();
  return lower.includes("unexpected token") ||
    lower.includes("unexpected identifier") ||
    lower.includes("unexpected end of json");
};

const buildToolCallEndEvents = (
  message: AssistantMessage,
): AssistantMessageEvent[] => {
  const events: AssistantMessageEvent[] = [];
  message.content.forEach((block, index): void => {
    if (block.type !== "toolCall") {
      return;
    }
    const toolBlock = block as ToolCallWithPartialArguments;
    if (!toolBlock.partialArgs || toolBlock.partialArgs.trim().length === 0) {
      return;
    }
    toolBlock.arguments = parseStreamingJson(toolBlock.partialArgs);
    const toolBlockRecord = toolBlock as unknown as Record<string, unknown>;
    delete toolBlockRecord["partialArgs"];
    events.push({
      type: "toolcall_end",
      contentIndex: index,
      toolCall: toolBlock,
      partial: message,
    });
  });
  return events;
};

const shouldRecoverToolCallError = (message: AssistantMessage): boolean => {
  if (!isToolCallParseError(message)) {
    return false;
  }
  return message.content.some((block): boolean => {
    if (block.type !== "toolCall") {
      return false;
    }
    const toolBlock = block as ToolCallWithPartialArguments;
    return typeof toolBlock.partialArgs === "string" && toolBlock.partialArgs.trim().length > 0;
  });
};

const finalizeRecoveredMessage = (message: AssistantMessage): void => {
  const hasToolCalls = message.content.some((block): boolean => block.type === "toolCall");
  message.stopReason = hasToolCalls ? "toolUse" : "stop";
  const messageRecord = message as unknown as Record<string, unknown>;
  delete messageRecord["errorMessage"];
};

export const streamOpenAiCompletionsSafe: StreamFn = (
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantStream => {
  if (model.api !== "openai-completions") {
    return streamSimple(model, context, options);
  }

  const baseStream = streamSimple(model, context, options);
  const stream = createAssistantMessageEventStream();

  (async (): Promise<void> => {
    try {
      for await (const event of baseStream) {
        if (event.type !== "error") {
          stream.push(event);
          continue;
        }

        const message = event.error;
        if (!shouldRecoverToolCallError(message)) {
          stream.push(event);
          stream.end();
          return;
        }

        const toolCallEvents = buildToolCallEndEvents(message);
        if (toolCallEvents.length === 0) {
          stream.push(event);
          stream.end();
          return;
        }

        finalizeRecoveredMessage(message);
        for (const toolEvent of toolCallEvents) {
          stream.push(toolEvent);
        }
        const reason: Extract<AssistantMessage["stopReason"], "stop" | "length" | "toolUse"> =
          message.stopReason === "toolUse" ? "toolUse" : "stop";
        stream.push({ type: "done", reason, message });
        stream.end();
        return;
      }
      stream.end();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const fallback: AssistantMessage = {
        role: "assistant",
        content: [{ type: "text", text: "" }],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "error",
        errorMessage,
        timestamp: Date.now(),
      };
      stream.push({ type: "error", reason: "error", error: fallback });
      stream.end();
    }
  })();

  return stream;
};
