// CRITICAL
import { randomUUID } from "node:crypto";
import type { AgentEvent, AgentMessage, ThinkingLevel } from "@mariozechner/pi-agent-core";
import { Agent } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, TextContent, ToolResultMessage, Usage } from "@mariozechner/pi-ai";
import { AsyncQueue } from "../../core/async";
import { Event } from "../event-manager";
import type { AppContext } from "../../types/context";
import { createOpenAiCompatibleModel } from "./model-factory";
import { buildAgentTools } from "./tool-registry";
import { mapAgentMessagesToLlm, mapStoredMessagesToAgentMessages } from "./message-mapper";
import { streamOpenAiCompletionsSafe } from "./stream-openai-completions-safe";

export interface ChatRunOptions {
  sessionId: string;
  messageId?: string;
  content: string;
  model?: string;
  systemPrompt?: string;
  mcpEnabled?: boolean;
  agentMode?: boolean;
  agentFiles?: boolean;
  deepResearch?: boolean;
  thinkingLevel?: ThinkingLevel;
}

export interface ChatRunStream {
  runId: string;
  stream: AsyncIterable<string>;
}

type ToolExecutionInfo = {
  toolName: string;
  args: Record<string, unknown>;
  startedAt: string;
};

/**
 * Controller-owned run manager for Pi agent sessions.
 */
export class ChatRunManager {
  private readonly context: AppContext;
  private readonly activeRuns = new Map<string, { agent: Agent; abort: AbortController }>();

  /**
   * Create a run manager.
   * @param context - Application context.
   */
  public constructor(context: AppContext) {
    this.context = context;
  }

  /**
   * Abort an in-flight run.
   * @param runId - Run identifier.
   * @returns True if a run was aborted.
   */
  public abortRun(runId: string): boolean {
    const active = this.activeRuns.get(runId);
    if (!active) {
      return false;
    }
    active.agent.abort();
    active.abort.abort();
    return true;
  }

  /**
   * Start a new chat run and return the SSE stream.
   * @param options - Run options.
   * @returns Run id and stream iterable.
   */
  public async startRun(options: ChatRunOptions): Promise<ChatRunStream> {
    const sessionId = options.sessionId;
    const session = this.context.stores.chatStore.getSession(sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    const content = options.content.trim();
    if (!content) {
      throw new Error("Message content is required");
    }

    const modelId = await this.resolveModelId(session, options.model);
    const systemPrompt = this.buildSystemPrompt(session, options.systemPrompt, options.agentMode ?? false);
    const thinkingLevel = options.thinkingLevel ?? (options.deepResearch ? "high" : "off");
    const baseUrl = `http://localhost:${this.context.config.port}/v1`;
    const model = createOpenAiCompatibleModel(modelId, baseUrl);

    const history = Array.isArray(session["messages"]) ? (session["messages"] as Array<Record<string, unknown>>) : [];
    const agentMessages = mapStoredMessagesToAgentMessages(history, model);

    const runId = randomUUID();
    const userMessageId = options.messageId ?? randomUUID();
    const userMetadata = { runId };
    this.context.stores.chatStore.addMessage(
      sessionId,
      userMessageId,
      "user",
      content,
      modelId,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      [{ type: "text", text: content }],
      userMetadata,
    );

    const runOptions = {
      userMessageId,
      model: modelId,
      status: "running",
      ...(systemPrompt ? { system: systemPrompt } : {}),
      ...(options.mcpEnabled || options.agentMode || options.agentFiles ? { toolsetId: "agent" } : {}),
    };

    this.context.stores.chatStore.createRun(runId, sessionId, runOptions);

    const queue = new AsyncQueue<string>(200);
    const abort = new AbortController();
    const agent = new Agent({
      initialState: {
        model,
        systemPrompt: systemPrompt ?? "",
        thinkingLevel,
        tools: [],
        messages: agentMessages,
      },
      convertToLlm: mapAgentMessagesToLlm,
      streamFn: streamOpenAiCompletionsSafe,
      getApiKey: (): string => this.resolveApiKey(),
      maxRetryDelayMs: 60_000,
    });
    agent.sessionId = sessionId;

    this.activeRuns.set(runId, { agent, abort });

    const toolExecutionStarts = new Map<string, ToolExecutionInfo>();
    const toolCallToMessageId = new Map<string, string>();
    let currentAssistantMessageId: string | null = null;
    let lastAssistantMessageId: string | null = null;
    let eventSeq = 0;
    let runStatus: "completed" | "error" | "aborted" = "completed";
    let runError: string | null = null;
    let turnIndex = -1;

    const publish = (type: string, data: Record<string, unknown>): void => {
      eventSeq += 1;
      const payload = {
        run_id: runId,
        session_id: sessionId,
        ...data,
      };
      this.context.stores.chatStore.addRunEvent(runId, eventSeq, type, payload);
      queue.push(this.encodeEvent(type, payload));
    };

    const publishPlanEvent = (type: string, data: Record<string, unknown>): void => {
      publish(type, data);
    };

    const tools = await buildAgentTools(this.context, {
      sessionId,
      mcpEnabled: Boolean(options.mcpEnabled),
      agentMode: Boolean(options.agentMode),
      agentFiles: Boolean(options.agentFiles),
      emitEvent: publishPlanEvent,
    });

    agent.setTools(tools);

    const unsubscribe = agent.subscribe((event) => {
      this.handleAgentEvent(event, {
        runId,
        sessionId,
        publish,
        toolExecutionStarts,
        toolCallToMessageId,
        userMessageId,
        setAssistantId: (id) => { currentAssistantMessageId = id; },
        setLastAssistantId: (id) => { lastAssistantMessageId = id; },
        getAssistantId: () => currentAssistantMessageId,
        getLastAssistantId: () => lastAssistantMessageId,
        getTurnIndex: () => turnIndex,
        setTurnIndex: (value) => { turnIndex = value; },
        markError: (message, status) => {
          runStatus = status;
          runError = message;
        },
      });
    });

    publish("run_start", {
      user_message_id: userMessageId,
      model: modelId,
    });

    const runPromise = agent
      .prompt(content)
      .catch((error) => {
        runStatus = abort.signal.aborted ? "aborted" : "error";
        runError = error instanceof Error ? error.message : String(error);
      })
      .finally(() => {
        unsubscribe();
        this.activeRuns.delete(runId);
        this.context.stores.chatStore.updateRun(runId, {
          status: runStatus,
          finishedAt: new Date().toISOString(),
        });
        publish("run_end", {
          status: runStatus,
          error: runError,
        });
        queue.close();
      });

    return {
      runId,
      stream: this.createStream(queue, abort, runPromise),
    };
  }

  /**
   * Encode a server-sent event payload.
   * @param type - Event type.
   * @param data - Event data.
   * @returns SSE formatted string.
   */
  private encodeEvent(type: string, data: Record<string, unknown>): string {
    return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  }

  /**
   * Create an async SSE stream from the queue.
   * @param queue - Outgoing SSE queue.
   * @param abort - Abort controller for stream lifecycle.
   * @param runPromise - Promise that resolves when the run finishes.
   * @returns Async iterable of SSE chunks.
   */
  private async *createStream(
    queue: AsyncQueue<string>,
    abort: AbortController,
    runPromise: Promise<void>,
  ): AsyncIterable<string> {
    try {
      while (true) {
        const value = await queue.shift(abort.signal);
        yield value;
      }
    } catch {
      // Stream closed or aborted.
    } finally {
      abort.abort();
      await runPromise;
    }
  }

  /**
   * Handle events emitted by the Pi agent runtime.
   * @param event - Agent event payload.
   * @param helpers - Helper callbacks and state.
   * @param helpers.runId - Run identifier.
   * @param helpers.sessionId - Session identifier.
   * @param helpers.publish - Publish function for SSE events.
   * @param helpers.toolExecutionStarts - Tool execution start map.
   * @param helpers.toolCallToMessageId - Tool call to message id map.
   * @param helpers.userMessageId - User message id.
   * @param helpers.setAssistantId - Setter for active assistant message id.
   * @param helpers.setLastAssistantId - Setter for last assistant message id.
   * @param helpers.getAssistantId - Getter for active assistant message id.
   * @param helpers.getLastAssistantId - Getter for last assistant message id.
   * @param helpers.markError - Mark run error and status.
   */
  private handleAgentEvent(
    event: AgentEvent,
    helpers: {
      runId: string;
      sessionId: string;
      publish: (type: string, data: Record<string, unknown>) => void;
      toolExecutionStarts: Map<string, ToolExecutionInfo>;
      toolCallToMessageId: Map<string, string>;
      userMessageId: string;
      setAssistantId: (id: string | null) => void;
      setLastAssistantId: (id: string | null) => void;
      getAssistantId: () => string | null;
      getLastAssistantId: () => string | null;
      getTurnIndex: () => number;
      setTurnIndex: (value: number) => void;
      markError: (message: string, status: "error" | "aborted") => void;
    },
  ): void {
    switch (event.type) {
      case "turn_start": {
        const nextIndex = helpers.getTurnIndex() + 1;
        helpers.setTurnIndex(nextIndex);
        helpers.publish("turn_start", { ...(event as Record<string, unknown>), turn_index: nextIndex });
        return;
      }
      case "message_start": {
        const message = event.message as AgentMessage;
        const turnIndex = helpers.getTurnIndex();
        const turnPayload = turnIndex >= 0 ? { turn_index: turnIndex } : {};
        if (message.role === "assistant") {
          const id = randomUUID();
          helpers.setAssistantId(id);
          helpers.publish("message_start", { message_id: id, message, ...turnPayload });
          return;
        }
        if (message.role === "user") {
          helpers.publish("message_start", { message_id: helpers.userMessageId, message, ...turnPayload });
          return;
        }
        helpers.publish("message_start", { message, ...turnPayload });
        return;
      }
      case "message_update": {
        const message = event.message as AgentMessage;
        const messageId = message.role === "assistant" ? helpers.getAssistantId() : undefined;
        const turnIndex = helpers.getTurnIndex();
        const turnPayload = turnIndex >= 0 ? { turn_index: turnIndex } : {};
        helpers.publish("message_update", {
          ...(messageId ? { message_id: messageId } : {}),
          message,
          assistantMessageEvent: event.assistantMessageEvent,
          ...turnPayload,
        });
        return;
      }
      case "message_end": {
        const message = event.message as AgentMessage;
        const turnIndex = helpers.getTurnIndex();
        const turnPayload = turnIndex >= 0 ? { turn_index: turnIndex } : {};
        if (message.role === "assistant") {
          const messageId = helpers.getAssistantId();
          helpers.setLastAssistantId(messageId);
          this.mapToolCallsToMessage(message as AssistantMessage, messageId, helpers.toolCallToMessageId);
          helpers.publish("message_end", { ...(messageId ? { message_id: messageId } : {}), message, ...turnPayload });
          return;
        }
        if (message.role === "user") {
          helpers.publish("message_end", { message_id: helpers.userMessageId, message, ...turnPayload });
          return;
        }
        helpers.publish("message_end", { message, ...turnPayload });
        return;
      }
      case "tool_execution_start": {
        const turnIndex = helpers.getTurnIndex();
        const turnPayload = turnIndex >= 0 ? { turn_index: turnIndex } : {};
        helpers.toolExecutionStarts.set(event.toolCallId, {
          toolName: event.toolName,
          args: event.args ?? {},
          startedAt: new Date().toISOString(),
        });
        helpers.publish("tool_execution_start", {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
          message_id: helpers.toolCallToMessageId.get(event.toolCallId),
          ...turnPayload,
        });
        return;
      }
      case "tool_execution_update": {
        const turnIndex = helpers.getTurnIndex();
        const turnPayload = turnIndex >= 0 ? { turn_index: turnIndex } : {};
        helpers.publish("tool_execution_update", {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
          partialResult: event.partialResult,
          message_id: helpers.toolCallToMessageId.get(event.toolCallId),
          ...turnPayload,
        });
        return;
      }
      case "tool_execution_end": {
        const turnIndex = helpers.getTurnIndex();
        const turnPayload = turnIndex >= 0 ? { turn_index: turnIndex } : {};
        const started = helpers.toolExecutionStarts.get(event.toolCallId);
        const finishedAt = new Date().toISOString();
        const toolServer = this.parseToolServer(event.toolName);
        const toolExecutionOptions = {
          arguments: started?.args ?? {},
          resultText: this.extractToolResultText(event.result?.content ?? event.result),
          isError: event.isError,
          finishedAt,
          ...(toolServer ? { toolServer } : {}),
          ...(started?.startedAt ? { startedAt: started.startedAt } : {}),
        };

        this.context.stores.chatStore.addToolExecution(
          helpers.runId,
          event.toolCallId,
          event.toolName,
          toolExecutionOptions,
        );
        helpers.publish("tool_execution_end", {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          result: event.result,
          isError: event.isError,
          message_id: helpers.toolCallToMessageId.get(event.toolCallId),
          ...turnPayload,
        });
        return;
      }
      case "turn_end": {
        const assistant = event.message as AssistantMessage;
        const messageId = helpers.getLastAssistantId();
        const turnIndex = helpers.getTurnIndex();
        const turnPayload = turnIndex >= 0 ? { turn_index: turnIndex } : {};
        if (assistant.stopReason === "error" || assistant.stopReason === "aborted") {
          helpers.markError(assistant.errorMessage ?? "Agent error", assistant.stopReason === "aborted" ? "aborted" : "error");
        }
        if (messageId) {
          this.persistAssistantMessage(
            helpers.sessionId,
            messageId,
            assistant,
            event.toolResults ?? [],
            helpers.runId,
            turnIndex >= 0 ? turnIndex : undefined,
          );
        }
        helpers.publish("turn_end", {
          message: assistant,
          toolResults: event.toolResults ?? [],
          message_id: messageId,
          ...turnPayload,
        });
        return;
      }
      case "agent_end":
      case "agent_start":
      default:
        helpers.publish(event.type, { ...(event as Record<string, unknown>) });
    }
  }

  /**
   * Map tool call ids to assistant message ids.
   * @param assistant - Assistant message with tool calls.
   * @param messageId - Assistant message id.
   * @param toolCallToMessageId - Mapping of tool call to message id.
   */
  private mapToolCallsToMessage(
    assistant: AssistantMessage,
    messageId: string | null,
    toolCallToMessageId: Map<string, string>,
  ): void {
    if (!messageId) return;
    for (const block of assistant.content) {
      if (block.type === "toolCall") {
        toolCallToMessageId.set(block.id, messageId);
      }
    }
  }

  /**
   * Persist an assistant message and tool calls to storage.
   * @param sessionId - Session identifier.
   * @param messageId - Message identifier.
   * @param assistant - Assistant message payload.
   * @param toolResults - Tool results for the turn.
   */
  private persistAssistantMessage(
    sessionId: string,
    messageId: string,
    assistant: AssistantMessage,
    toolResults: ToolResultMessage[],
    runId: string,
    turnIndex?: number,
  ): void {
    const contentText = assistant.content
      .filter((block): block is TextContent => block.type === "text")
      .map((block) => block.text)
      .join("");

    const toolResultsById = new Map<string, ToolResultMessage>();
    for (const result of toolResults) {
      toolResultsById.set(result.toolCallId, result);
    }

    const parts: Array<Record<string, unknown>> = [];
    const toolCalls: Array<Record<string, unknown>> = [];

    for (const block of assistant.content) {
      if (block.type === "text") {
        parts.push({ type: "text", text: block.text });
      } else if (block.type === "thinking") {
        parts.push({ type: "reasoning", text: block.thinking });
      } else if (block.type === "toolCall") {
        parts.push({
          type: "dynamic-tool",
          toolCallId: block.id,
          toolName: block.name,
          input: block.arguments ?? {},
          state: "input-available",
        });
        const result = toolResultsById.get(block.id);
        if (result) {
          const resultText = this.extractToolResultText(result.content);
          if (result.isError) {
            parts[parts.length - 1] = {
              ...parts[parts.length - 1],
              state: "output-error",
              errorText: resultText,
            };
          } else {
            parts[parts.length - 1] = {
              ...parts[parts.length - 1],
              state: "output-available",
              output: resultText,
            };
          }
        }

        toolCalls.push({
          id: block.id,
          type: "function",
          function: {
            name: block.name,
            arguments: JSON.stringify(block.arguments ?? {}),
          },
          ...(result
            ? {
                result: {
                  content: this.extractToolResultText(result.content),
                  isError: result.isError,
                },
              }
            : {}),
        });
      }
    }

    const usage = this.toLanguageUsage(assistant.usage);
    const metadata: Record<string, unknown> = {
      model: assistant.model,
      usage,
      runId,
    };
    if (typeof turnIndex === "number") {
      metadata["turnIndex"] = turnIndex;
    }

    this.context.stores.chatStore.addMessage(
      sessionId,
      messageId,
      "assistant",
      contentText,
      assistant.model,
      toolCalls.length > 0 ? toolCalls : undefined,
      usage?.inputTokens,
      undefined,
      usage?.totalTokens,
      usage?.outputTokens,
      parts,
      metadata,
    );

    const sessionSummary = this.context.stores.chatStore.getSessionSummary(sessionId);
    this.context.eventManager.publish(new Event("chat_message_upserted", {
      session_id: sessionId,
      message: {
        id: messageId,
        role: "assistant",
        content: contentText,
        model: assistant.model,
        tool_calls: toolCalls,
        parts,
        metadata,
      },
      session: sessionSummary,
    }));
    const usageSummary = this.context.stores.chatStore.getUsage(sessionId);
    this.context.eventManager.publish(new Event("chat_usage_updated", { session_id: sessionId, usage: usageSummary }));
  }

  /**
   * Convert model usage to stored usage format.
   * @param usage - Usage payload.
   * @returns Normalized usage or undefined.
   */
  private toLanguageUsage(
    usage: Usage | undefined,
  ): { inputTokens: number; outputTokens: number; totalTokens: number } | undefined {
    if (!usage) return undefined;
    return {
      inputTokens: usage.input,
      outputTokens: usage.output,
      totalTokens: usage.totalTokens,
    };
  }

  /**
   * Extract a displayable string from a tool result.
   * @param result - Tool result content.
   * @returns Text content.
   */
  private extractToolResultText(result: unknown): string {
    if (Array.isArray(result)) {
      return result
        .filter((item) => item && typeof item === "object" && (item as Record<string, unknown>)["type"] === "text")
        .map((item) => String((item as Record<string, unknown>)["text"] ?? ""))
        .join("\n");
    }
    if (result && typeof result === "object" && "content" in (result as Record<string, unknown>)) {
      const content = (result as Record<string, unknown>)["content"];
      return typeof content === "string" ? content : JSON.stringify(content);
    }
    return typeof result === "string" ? result : JSON.stringify(result ?? "");
  }

  /**
   * Parse the MCP server prefix from a tool name.
   * @param toolName - Tool name (server__tool).
   * @returns Server id or null.
   */
  private parseToolServer(toolName: string): string | null {
    const parts = toolName.split("__");
    if (parts.length > 1) return parts[0] ?? null;
    return null;
  }

  /**
   * Resolve model id from override, session, or running process.
   * @param session - Session record.
   * @param override - Optional model override.
   * @returns Model identifier.
   */
  private async resolveModelId(
    session: Record<string, unknown>,
    override?: string,
  ): Promise<string> {
    if (override) return override;
    const sessionModel = typeof session["model"] === "string" ? session["model"] : undefined;
    if (sessionModel) return sessionModel;
    const current = await this.context.processManager.findInferenceProcess(this.context.config.inference_port);
    if (current?.served_model_name) return current.served_model_name;
    if (current?.model_path) {
      const parts = current.model_path.split("/");
      const tail = parts[parts.length - 1];
      if (tail) return tail;
    }
    return "default";
  }

  /**
   * Resolve API key for model calls.
   * @returns API key string.
   */
  private resolveApiKey(): string {
    return this.context.config.api_key ?? process.env["OPENAI_API_KEY"] ?? "none";
  }

  /**
   * Build the system prompt with optional agent-mode instructions.
   * @param session - Session record.
   * @param systemPrompt - User-provided system prompt.
   * @param agentMode - Whether agent mode is enabled.
   * @returns System prompt string or undefined.
   */
  private buildSystemPrompt(
    session: Record<string, unknown>,
    systemPrompt: string | undefined,
    agentMode: boolean,
  ): string | undefined {
    const base = (systemPrompt ?? "").trim();
    if (!agentMode) {
      return base || undefined;
    }
    const agentBlock = this.buildAgentModePrompt(session);
    if (!agentBlock) return base || undefined;
    return base ? `${base}\n\n${agentBlock}` : agentBlock;
  }

  /**
   * Build the agent-mode prompt block.
   * @param session - Session record.
   * @returns Agent-mode prompt or undefined.
   */
  private buildAgentModePrompt(session: Record<string, unknown>): string | undefined {
    const state = session["agent_state"] as Record<string, unknown> | undefined;
    const plan = state?.["plan"] as Record<string, unknown> | undefined;
    const steps = Array.isArray(plan?.["steps"]) ? (plan?.["steps"] as Array<Record<string, unknown>>) : [];

    const lines: string[] = [];
    lines.push("<agent_mode>");
    lines.push("You are in AGENT MODE with access to planning and file tools.");
    lines.push("");
    lines.push("## Workflow");
    lines.push("1. If NO <current_plan> exists: call create_plan ONCE with 3-8 steps.");
    lines.push("2. Execute each step using tools. Mark steps done with update_plan({ action: 'complete', step_index: N }).");
    lines.push("3. For files: write_file creates parent directories automatically - no need for make_directory.");
    lines.push("4. Continue until all steps are done, then summarize results.");
    lines.push("");
    lines.push("## Tool Examples");
    lines.push("- create_plan({ tasks: [{ title: 'Research X' }, { title: 'Write report' }] })");
    lines.push("- update_plan({ action: 'complete', step_index: 0 })");
    lines.push("- write_file({ path: 'research/notes.md', content: '# Notes\\n...' })");
    lines.push("- read_file({ path: 'notes.md' })");
    lines.push("");
    lines.push("## Rules");
    lines.push("- Do NOT loop on plan creation. Create plan ONCE.");
    lines.push("- Do NOT describe what you could do — just DO IT with tools.");
    lines.push("- Mark each step complete IMMEDIATELY after finishing it.");

    if (steps.length > 0) {
      const doneCount = steps.filter((s) => s["status"] === "done").length;
      const currentIndex = steps.findIndex((s) => s["status"] !== "done");
      const planLines = steps.map((step, index) => {
        const status = step["status"];
        const marker = status === "done"
          ? "[x]"
          : index === currentIndex
            ? "[>]"
            : status === "blocked"
              ? "[!]"
              : "[ ]";
        return `  ${marker} ${index}: ${String(step["title"] ?? "")}`;
      });

      lines.push("");
      lines.push("<current_plan>");
      lines.push(`Progress: ${doneCount}/${steps.length}`);
      lines.push(...planLines);
      if (currentIndex >= 0) {
        const currentStep = steps[currentIndex];
        if (currentStep) {
          lines.push(`Current step: ${currentIndex} — ${String(currentStep["title"] ?? "")}`);
        }
      } else {
        lines.push("All steps complete. Provide final summary.");
      }
      lines.push("</current_plan>");
    }

    lines.push("</agent_mode>");
    return lines.join("\n");
  }

  // currentRunId/currentSessionId intentionally omitted; run + session are tracked per stream.
}
