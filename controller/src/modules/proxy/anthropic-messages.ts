export type WireRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is WireRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const textFromBlocks = (blocks: unknown): string =>
  asArray(blocks)
    .filter(isRecord)
    .filter((block) => block["type"] === "text" && typeof block["text"] === "string")
    .map((block) => block["text"] as string)
    .join("\n");

const systemToOpenAI = (system: unknown): WireRecord | null => {
  if (typeof system === "string" && system.length > 0) {
    return { role: "system", content: system };
  }
  if (Array.isArray(system)) {
    const text = textFromBlocks(system);
    if (text) return { role: "system", content: text };
  }
  return null;
};

const imageBlockToOpenAI = (source: WireRecord): WireRecord | null => {
  if (source["type"] === "base64" && typeof source["data"] === "string") {
    const mediaType = typeof source["media_type"] === "string" ? source["media_type"] : "image/png";
    return { type: "image_url", image_url: { url: `data:${mediaType};base64,${source["data"]}` } };
  }
  if (source["type"] === "url" && typeof source["url"] === "string") {
    return { type: "image_url", image_url: { url: source["url"] } };
  }
  return null;
};

const toolResultContent = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return textFromBlocks(content);
  return "";
};

const toolUseToCall = (block: WireRecord): WireRecord => ({
  id: typeof block["id"] === "string" ? block["id"] : "",
  type: "function",
  function: {
    name: typeof block["name"] === "string" ? block["name"] : "",
    arguments: JSON.stringify(isRecord(block["input"]) ? block["input"] : {}),
  },
});

const userBlocksToMessages = (blocks: unknown[]): WireRecord[] => {
  const messages: WireRecord[] = [];
  const parts: WireRecord[] = [];
  for (const block of blocks) {
    if (!isRecord(block)) continue;
    if (block["type"] === "tool_result") {
      messages.push({
        role: "tool",
        tool_call_id: typeof block["tool_use_id"] === "string" ? block["tool_use_id"] : "",
        content: toolResultContent(block["content"]),
      });
      continue;
    }
    if (block["type"] === "text" && typeof block["text"] === "string") {
      parts.push({ type: "text", text: block["text"] });
      continue;
    }
    if (block["type"] === "image" && isRecord(block["source"])) {
      const image = imageBlockToOpenAI(block["source"]);
      if (image) parts.push(image);
    }
  }
  if (parts.length > 0) {
    const onlyText = parts.every((part) => part["type"] === "text");
    messages.push({
      role: "user",
      content: onlyText ? parts.map((part) => part["text"] as string).join("\n") : parts,
    });
  }
  return messages;
};

const assistantBlocksToMessage = (blocks: unknown[]): WireRecord => {
  const textParts: string[] = [];
  const toolCalls: WireRecord[] = [];
  for (const block of blocks) {
    if (!isRecord(block)) continue;
    if (block["type"] === "text" && typeof block["text"] === "string") {
      textParts.push(block["text"]);
    }
    if (block["type"] === "tool_use") {
      toolCalls.push(toolUseToCall(block));
    }
  }
  const message: WireRecord = { role: "assistant", content: textParts.join("\n") || null };
  if (toolCalls.length > 0) message["tool_calls"] = toolCalls;
  return message;
};

const messageToOpenAI = (message: WireRecord): WireRecord[] => {
  const role = message["role"];
  const content = message["content"];
  if (typeof content === "string") {
    return [{ role, content }];
  }
  const blocks = asArray(content);
  if (role === "assistant") return [assistantBlocksToMessage(blocks)];
  return userBlocksToMessages(blocks);
};

const toolToOpenAI = (tool: WireRecord): WireRecord => ({
  type: "function",
  function: {
    name: typeof tool["name"] === "string" ? tool["name"] : "",
    description: typeof tool["description"] === "string" ? tool["description"] : "",
    parameters: isRecord(tool["input_schema"]) ? tool["input_schema"] : { type: "object" },
  },
});

const toolChoiceToOpenAI = (choice: unknown): unknown => {
  if (!isRecord(choice)) return undefined;
  if (choice["type"] === "auto") return "auto";
  if (choice["type"] === "any") return "required";
  if (choice["type"] === "tool" && typeof choice["name"] === "string") {
    return { type: "function", function: { name: choice["name"] } };
  }
  return undefined;
};

export const anthropicRequestToOpenAI = (body: WireRecord): WireRecord => {
  const messages: WireRecord[] = [];
  const system = systemToOpenAI(body["system"]);
  if (system) messages.push(system);
  for (const message of asArray(body["messages"])) {
    if (isRecord(message)) messages.push(...messageToOpenAI(message));
  }
  const openai: WireRecord = { model: body["model"], messages };
  if (typeof body["max_tokens"] === "number") openai["max_tokens"] = body["max_tokens"];
  if (typeof body["temperature"] === "number") openai["temperature"] = body["temperature"];
  if (typeof body["top_p"] === "number") openai["top_p"] = body["top_p"];
  if (Array.isArray(body["stop_sequences"]) && body["stop_sequences"].length > 0) {
    openai["stop"] = body["stop_sequences"];
  }
  const tools = asArray(body["tools"]).filter(isRecord);
  if (tools.length > 0) openai["tools"] = tools.map(toolToOpenAI);
  const toolChoice = toolChoiceToOpenAI(body["tool_choice"]);
  if (toolChoice !== undefined) openai["tool_choice"] = toolChoice;
  if (body["stream"] === true) openai["stream"] = true;
  return openai;
};

const STOP_REASONS: Record<string, string> = {
  stop: "end_turn",
  length: "max_tokens",
  tool_calls: "tool_use",
};

export const mapStopReason = (finishReason: unknown): string =>
  (typeof finishReason === "string" && STOP_REASONS[finishReason]) || "end_turn";

const parseToolArguments = (value: unknown): WireRecord => {
  if (typeof value !== "string" || value.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const toolCallToBlock = (call: WireRecord): WireRecord => {
  const fn = isRecord(call["function"]) ? call["function"] : {};
  return {
    type: "tool_use",
    id: typeof call["id"] === "string" ? call["id"] : "",
    name: typeof fn["name"] === "string" ? fn["name"] : "",
    input: parseToolArguments(fn["arguments"]),
  };
};

export const openAIResponseToAnthropic = (result: WireRecord): WireRecord => {
  const choice = asArray(result["choices"]).filter(isRecord)[0] ?? {};
  const message = isRecord(choice["message"]) ? choice["message"] : {};
  const content: WireRecord[] = [];
  if (typeof message["content"] === "string" && message["content"].length > 0) {
    content.push({ type: "text", text: message["content"] });
  }
  for (const call of asArray(message["tool_calls"]).filter(isRecord)) {
    content.push(toolCallToBlock(call));
  }
  const usage = isRecord(result["usage"]) ? result["usage"] : {};
  return {
    id: typeof result["id"] === "string" ? result["id"] : "msg_local",
    type: "message",
    role: "assistant",
    content,
    model: typeof result["model"] === "string" ? result["model"] : "",
    stop_reason: mapStopReason(choice["finish_reason"]),
    stop_sequence: null,
    usage: {
      input_tokens: typeof usage["prompt_tokens"] === "number" ? usage["prompt_tokens"] : 0,
      output_tokens: typeof usage["completion_tokens"] === "number" ? usage["completion_tokens"] : 0,
    },
  };
};

export const anthropicErrorBody = (message: string, type = "api_error"): WireRecord => ({
  type: "error",
  error: { type, message },
});

export const anthropicPromptText = (body: WireRecord): string => {
  const parts: string[] = [];
  if (typeof body["system"] === "string") parts.push(body["system"]);
  if (Array.isArray(body["system"])) parts.push(textFromBlocks(body["system"]));
  for (const message of asArray(body["messages"])) {
    if (!isRecord(message)) continue;
    if (typeof message["content"] === "string") {
      parts.push(message["content"]);
      continue;
    }
    parts.push(textFromBlocks(message["content"]));
  }
  const tools = asArray(body["tools"]);
  if (tools.length > 0) parts.push(JSON.stringify(tools));
  return parts.filter((part) => part.length > 0).join("\n");
};
