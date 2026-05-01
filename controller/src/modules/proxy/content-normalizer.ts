export const normalizeToolRequest = (payload: Record<string, unknown>): Record<string, unknown> => {
  if (payload["functions"] && !payload["tools"] && Array.isArray(payload["functions"])) {
    payload["tools"] = (payload["functions"] as Array<Record<string, unknown>>).map(
      (functionDefinition) => ({
        type: "function",
        function: functionDefinition,
      })
    );
    delete payload["functions"];
  }
  if (payload["tool_choice"] === "auto") {
    delete payload["tool_choice"];
  }
  return payload;
};

const collapseTextContentParts = (content: unknown): string | null => {
  if (!Array.isArray(content)) {
    return null;
  }

  const chunks: string[] = [];
  for (const part of content) {
    if (typeof part === "string") {
      chunks.push(part);
      continue;
    }
    if (!part || typeof part !== "object" || Array.isArray(part)) {
      return null;
    }

    const record = part as Record<string, unknown>;
    const type = typeof record["type"] === "string" ? record["type"] : "";
    if (type !== "text" && type !== "input_text") {
      return null;
    }
    const text = record["text"];
    if (typeof text === "string") {
      chunks.push(text);
      continue;
    }
    return null;
  }

  return chunks.join("");
};

export const normalizeChatMessageContentParts = (payload: Record<string, unknown>): boolean => {
  const messages = payload["messages"];
  if (!Array.isArray(messages)) {
    return false;
  }

  let changed = false;
  for (const message of messages) {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      continue;
    }

    const record = message as Record<string, unknown>;
    const collapsed = collapseTextContentParts(record["content"]);
    if (collapsed === null) {
      continue;
    }

    record["content"] = collapsed;
    changed = true;
  }

  return changed;
};
