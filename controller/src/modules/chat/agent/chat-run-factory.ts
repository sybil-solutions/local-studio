import { randomUUID } from "node:crypto";
import { Agent } from "@mariozechner/pi-agent-core";
import type { ImageContent } from "@mariozechner/pi-ai";
import type { AppContext } from "../../../types/context";
import { AsyncQueue } from "../../../core/async";
import { handleAgentEvent, type ToolExecutionInfo } from "./agent-event-handler";
import { createOpenAiCompatibleModel } from "./model-factory";
import { buildAgentTools } from "./tool-registry";
import { mapAgentMessagesToLlm, mapStoredMessagesToAgentMessages } from "./message-mapper";
import { streamOpenAiCompletionsSafe } from "./stream-openai-completions-safe";
import { buildSystemPrompt } from "./system-prompt-builder";
import { persistAssistantMessage, extractToolResultText } from "./run-manager-persistence";
import { createRunPublisher, createSseStream } from "./run-manager-sse";
import { AGENT_RUN_EVENT_TYPES, type AgentEventType } from "./contracts";
import { createMessageCleaner } from "./run-manager-utf8";
import { resolveModel, resolveApiKey } from "./run-manager-model-resolver";
import type { ChatRunOptions, ChatRunStream } from "./run-manager-types";
import { mapToolCallsToMessage, parseToolServer } from "./run-manager-utils";
import type { RunRegistry } from "./run-registry";

const RUN_EVENT_QUEUE_CAPACITY = 1024;

/**
 * Create a streaming chat run backed by the Pi agent loop.
 * @param context - Application context.
 * @param activeRuns - Mutable run registry used for abort and eviction integration.
 * @param options - Run options from the chats route.
 * @returns Run identifier and SSE stream.
 */
export async function createChatRun(
  context: AppContext,
  activeRuns: RunRegistry,
  options: ChatRunOptions
): Promise<ChatRunStream> {
  const sessionId = options.sessionId;
  const session = context.stores.chatStore.getSession(sessionId);
  if (!session) {
    throw new Error("Session not found");
  }

  const content = options.content.trim();
  const hasImageInput = Array.isArray(options.images) && options.images.length > 0;
  if (!content && !hasImageInput) {
    throw new Error("Message content is required");
  }

  const modelSelection = await resolveModel(context, session, options.model, options.provider);
  const requestModel = modelSelection.requestModel;
  const storedModel = modelSelection.storedModel;
  const provider = modelSelection.provider;
  const apiKey = resolveApiKey(context, provider);

  const systemPrompt = buildSystemPrompt(session, options.systemPrompt, options.agentMode ?? false);
  const thinkingLevel = options.thinkingLevel ?? (options.deepResearch ? "high" : "off");
  const baseUrl = `http://localhost:${context.config.port}/v1`;
  const model = createOpenAiCompatibleModel(requestModel, baseUrl, provider);

  const history = Array.isArray(session["messages"])
    ? (session["messages"] as Array<Record<string, unknown>>)
    : [];
  const agentMessages = mapStoredMessagesToAgentMessages(history, model);

  const runId = randomUUID();
  const userMessageId = options.messageId ?? randomUUID();
  const userMetadata = { runId };

  const userParts: Array<Record<string, unknown>> = [];
  if (content) {
    userParts.push({ type: "text", text: content });
  }

  const agentImages: ImageContent[] = [];
  if (options.images && options.images.length > 0) {
    for (const img of options.images) {
      userParts.push({ type: "image", data: img.data, mimeType: img.mimeType, name: img.name });
      agentImages.push({ type: "image", data: img.data, mimeType: img.mimeType });
    }
  }

  context.stores.chatStore.addMessage(
    sessionId,
    userMessageId,
    "user",
    content,
    storedModel,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    userParts.length > 0 ? userParts : [{ type: "text", text: content }],
    userMetadata
  );

  const runOptions = {
    userMessageId,
    model: storedModel,
    status: "running",
    ...(systemPrompt ? { system: systemPrompt } : {}),
    ...(options.agentMode || options.agentFiles ? { toolsetId: "agent" } : {}),
  };
  context.stores.chatStore.createRun(runId, sessionId, runOptions);

  const queue = new AsyncQueue<string>(RUN_EVENT_QUEUE_CAPACITY);
  const abort = new AbortController();
  const runEntry = activeRuns.createRun(
    runId,
    new Agent({
      initialState: {
        model,
        systemPrompt: systemPrompt ?? "",
        thinkingLevel,
        tools: [],
        messages: agentMessages,
      },
      convertToLlm: mapAgentMessagesToLlm,
      streamFn: streamOpenAiCompletionsSafe,
      getApiKey: (): string => apiKey,
      maxRetryDelayMs: 60_000,
    }),
    abort,
    requestModel,
    provider
  );
  const agent = runEntry.agent;
  agent.sessionId = sessionId;

  activeRuns.markRunning(runId);

  const toolExecutionStarts = new Map<string, ToolExecutionInfo>();
  const toolCallToMessageId = new Map<string, string>();
  let currentAssistantMessageId: string | null = null;
  let lastAssistantMessageId: string | null = null;
  let runStatus: "completed" | "error" | "aborted" = "completed";
  let runError: string | null = null;
  let turnIndex = -1;

  const cleanMessage = createMessageCleaner();

  const { publish } = createRunPublisher(context, { runId, sessionId, queue });

  const publishPlanEvent = (type: AgentEventType, data: Record<string, unknown>): void => {
    publish(type, data);
  };

  const tools = await buildAgentTools(context, {
    sessionId,
    agentMode: Boolean(options.agentMode),
    agentFiles: Boolean(options.agentFiles),
    emitEvent: publishPlanEvent,
  });
  agent.setTools(tools);

  const unsubscribe = agent.subscribe((event) => {
    handleAgentEvent(
      event,
      {
        runId,
        sessionId,
        publish,
        toolExecutionStarts,
        toolCallToMessageId,
        userMessageId,
        setAssistantId: (id) => {
          currentAssistantMessageId = id;
        },
        setLastAssistantId: (id) => {
          lastAssistantMessageId = id;
        },
        getAssistantId: () => currentAssistantMessageId,
        getLastAssistantId: () => lastAssistantMessageId,
        cleanMessage,
        getTurnIndex: () => turnIndex,
        setTurnIndex: (value) => {
          turnIndex = value;
        },
        markError: (message, status) => {
          runStatus = status;
          runError = message;
        },
      },
      {
        createMessageId: () => randomUUID(),
        mapToolCallsToMessage: (assistant, messageId, mapping) => {
          mapToolCallsToMessage(assistant, messageId, mapping);
        },
        persistAssistantMessage: (sid, mid, assistant, toolResults, rid, tIndex, toolArgsMap) => {
          persistAssistantMessage(context, {
            sessionId: sid,
            messageId: mid,
            assistant,
            toolResults,
            runId: rid,
            ...(typeof tIndex === "number" ? { turnIndex: tIndex } : {}),
            toolArgs: toolArgsMap,
          });
        },
        addToolExecution: (rid, toolCallId, toolName, toolExecutionOptions) => {
          context.stores.chatStore.addToolExecution(rid, toolCallId, toolName, toolExecutionOptions);
        },
        parseToolServer: (toolName) => parseToolServer(toolName),
        extractToolResultText: (result) => extractToolResultText(result),
      }
    );
  });

  publish(AGENT_RUN_EVENT_TYPES.RUN_START, {
    user_message_id: userMessageId,
    model: storedModel,
  });

  const runPromise = agent
    .prompt(content, agentImages.length > 0 ? agentImages : undefined)
    .catch((error) => {
      runStatus = abort.signal.aborted ? "aborted" : "error";
      runError = error instanceof Error ? error.message : String(error);
    })
    .finally(() => {
      unsubscribe();
      activeRuns.markFinished(runId);
      context.stores.chatStore.updateRun(runId, {
        status: runStatus,
        finishedAt: new Date().toISOString(),
      });
      publish(AGENT_RUN_EVENT_TYPES.RUN_END, {
        status: runStatus,
        error: runError,
      });
      queue.close();
    });

  return {
    runId,
    stream: createSseStream(queue, abort, runPromise),
  };
}
