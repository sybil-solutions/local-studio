// CRITICAL
import { randomUUID } from "node:crypto";
import type { AppContext } from "../types/context";
import { badRequest, notFound, serviceUnavailable } from "../core/errors";

const COMPACTION_SYSTEM_PROMPT = [
  "You are a context-compaction assistant.",
  "Summarize the conversation so it can replace the full history.",
  "The original first user message and the latest message will be preserved separately.",
  "Do not repeat those messages verbatim; focus on key facts, decisions, preferences, and open tasks.",
  "Include important tool outputs, artifacts, and code references when relevant.",
  "Keep the summary under 10k tokens and use concise bullets and short sections.",
].join("\n\n");

const COMPACTION_USER_PROMPT = "Summarize the conversation above for context compaction.";

type MessageRecord = Record<string, unknown>;

export interface ChatCompactionOptions {
  model?: string;
  systemPrompt?: string;
  title?: string;
  preserveFirst?: boolean;
  preserveLast?: boolean;
}

export interface ChatCompactionResult {
  session: Record<string, unknown>;
  summary: string;
}

const getString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const getNumber = (value: unknown): number | undefined =>
  typeof value === "number" && !Number.isNaN(value) ? value : undefined;

const formatToolCalls = (toolCalls: unknown[]): string => {
  const formatted = toolCalls
    .map((call) => {
      if (!call || typeof call !== "object") return null;
      const record = call as Record<string, unknown>;
      const fn = record["function"] as Record<string, unknown> | undefined;
      const name = getString(fn?.["name"]) ?? "tool";
      const args = getString(fn?.["arguments"]);
      return args ? `${name}(${args})` : `${name}()`;
    })
    .filter((value): value is string => Boolean(value));
  return formatted.length > 0 ? `\n\n[Tool calls]: ${formatted.join("; ")}` : "";
};

const buildSummaryMessages = (messages: MessageRecord[]): Array<{ role: string; content: string }> => {
  return messages
    .map((message) => {
      const role = getString(message["role"]) ?? "assistant";
      const content = getString(message["content"]) ?? "";
      const toolCalls = Array.isArray(message["tool_calls"]) ? message["tool_calls"] : [];
      const toolSuffix = toolCalls.length > 0 ? formatToolCalls(toolCalls) : "";
      const combined = `${content}${toolSuffix}`.trim();
      if (!combined) return null;
      return { role, content: combined };
    })
    .filter((value): value is { role: string; content: string } => Boolean(value));
};

const buildSystemPrompt = (systemPrompt?: string): string => {
  if (systemPrompt && systemPrompt.trim()) {
    return `${COMPACTION_SYSTEM_PROMPT}\n\nOriginal system prompt:\n${systemPrompt.trim()}`;
  }
  return COMPACTION_SYSTEM_PROMPT;
};

const resolveModel = (options: ChatCompactionOptions, session: MessageRecord, fallbackModel?: string): string => {
  return (
    options.model ||
    getString(session["model"]) ||
    fallbackModel ||
    "default"
  );
};

const requestSummary = async (
  context: AppContext,
  model: string,
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
): Promise<string> => {
  const response = await fetch(`http://localhost:${context.config.inference_port}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages,
        { role: "user", content: COMPACTION_USER_PROMPT },
      ],
      temperature: 0.3,
      stream: false,
    }),
  });

  if (!response.ok) {
    throw serviceUnavailable(`Compaction summary failed (${response.status})`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const summary = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!summary) {
    throw badRequest("Compaction summary returned empty content");
  }
  return summary;
};

const createSummaryMessage = (summary: string, model?: string): MessageRecord => ({
  role: "assistant",
  content: `Context summary (compacted on ${new Date().toLocaleString()}):\n\n${summary}`,
  model: model ?? null,
});

const pickFirstUserMessage = (messages: MessageRecord[]): MessageRecord | null =>
  messages.find((message) => getString(message["role"]) === "user") ?? null;

const pickLastMessage = (messages: MessageRecord[]): MessageRecord | null =>
  messages.length > 0 ? messages[messages.length - 1] : null;

const cloneMessageToSession = (
  context: AppContext,
  sessionId: string,
  message: MessageRecord,
): void => {
  const role = getString(message["role"]) ?? "assistant";
  const content = getString(message["content"]) ?? undefined;
  const model = getString(message["model"]) ?? undefined;
  const toolCalls = Array.isArray(message["tool_calls"]) ? message["tool_calls"] : undefined;
  const promptTokens = getNumber(message["request_prompt_tokens"]);
  const toolsTokens = getNumber(message["request_tools_tokens"]);
  const totalInputTokens = getNumber(message["request_total_input_tokens"]);
  const completionTokens = getNumber(message["request_completion_tokens"]);

  context.stores.chatStore.addMessage(
    sessionId,
    randomUUID(),
    role,
    content,
    model,
    toolCalls,
    promptTokens,
    toolsTokens,
    totalInputTokens,
    completionTokens,
  );
};

export const compactChatSession = async (
  context: AppContext,
  sessionId: string,
  options: ChatCompactionOptions = {},
): Promise<ChatCompactionResult> => {
  const session = context.stores.chatStore.getSession(sessionId);
  if (!session) {
    throw notFound("Session not found");
  }

  const current = await context.processManager.findInferenceProcess(context.config.inference_port);
  if (!current) {
    throw serviceUnavailable("No model running");
  }

  const messages = Array.isArray(session["messages"]) ? (session["messages"] as MessageRecord[]) : [];
  if (messages.length === 0) {
    throw badRequest("Session has no messages to compact");
  }

  const summaryMessages = buildSummaryMessages(messages);
  if (summaryMessages.length === 0) {
    throw badRequest("Session messages are empty");
  }

  const systemPrompt = buildSystemPrompt(options.systemPrompt);
  const model = resolveModel(options, session, current.served_model_name ?? undefined);
  const summaryText = await requestSummary(context, model, systemPrompt, summaryMessages);

  const firstUser = options.preserveFirst === false ? null : pickFirstUserMessage(messages);
  const lastMessage = options.preserveLast === false ? null : pickLastMessage(messages);

  const titleBase = getString(session["title"]) ?? "Chat";
  const newTitle = options.title ?? `${titleBase} (Compacted)`;
  const newSessionId = randomUUID();
  const newSession = context.stores.chatStore.createSession(newSessionId, newTitle, model, sessionId);

  if (firstUser) {
    cloneMessageToSession(context, newSessionId, firstUser);
  }

  const summaryMessage = createSummaryMessage(summaryText, model);
  cloneMessageToSession(context, newSessionId, summaryMessage);

  if (lastMessage && (!firstUser || lastMessage["id"] !== firstUser["id"])) {
    cloneMessageToSession(context, newSessionId, lastMessage);
  }

  const hydrated = context.stores.chatStore.getSession(newSessionId) ?? newSession;

  return {
    session: hydrated,
    summary: summaryText,
  };
};
