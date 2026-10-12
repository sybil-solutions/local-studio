/**
 * OpenAI's hosted Responses API is lenient about item shapes; vLLM validates
 * them against the official pydantic schemas with zero tolerance. Coding
 * agents in the wild send the lenient dialect — chat-style `"text"` content
 * parts, assistant history messages carrying `output_text` parts without the
 * full output-item wrapper, chat-nested tool definitions — and vLLM 400s the
 * whole request. This is the one place the proxy translates: rewrite those
 * lax shapes into the strict equivalents vLLM accepts, leave everything that
 * already conforms untouched.
 */

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

const INPUT_ROLES = new Set(["user", "system", "developer"]);

let syntheticId = 0;
const nextMessageId = (): string => `msg_lax_${++syntheticId}`;

/** Chat-style `text` part → `input_text` (user/system/developer messages). */
const normalizeInputPart = (part: unknown): unknown => {
  if (!isRec(part)) return part;
  if (part["type"] === "text") return { ...part, type: "input_text" };
  return part;
};

/** `text`/`input_text` part → `output_text` with required `annotations` (assistant). */
const normalizeOutputPart = (part: unknown): unknown => {
  if (!isRec(part)) return part;
  const type = part["type"];
  if (type === "text" || type === "input_text") {
    return { type: "output_text", text: part["text"], annotations: part["annotations"] ?? [] };
  }
  if (type === "output_text" && !("annotations" in part)) {
    return { ...part, annotations: [] };
  }
  return part;
};

const normalizeInputItem = (item: unknown): unknown => {
  if (!isRec(item)) return item;
  // Only message-like items need repair; function_call, function_call_output,
  // reasoning, item_reference, etc. pass vLLM's validation as sent.
  const type = item["type"];
  if (type !== undefined && type !== "message") return item;
  const role = item["role"];
  const content = item["content"];

  if (typeof role === "string" && INPUT_ROLES.has(role)) {
    if (!Array.isArray(content)) return item;
    return { ...item, content: content.map(normalizeInputPart) };
  }

  if (role === "assistant") {
    // Plain-string content is valid as an easy input message; arrays are only
    // valid inside a full output message item (type/id/status all required).
    if (!Array.isArray(content)) return item;
    return {
      type: "message",
      role: "assistant",
      id: typeof item["id"] === "string" ? item["id"] : nextMessageId(),
      status: typeof item["status"] === "string" ? item["status"] : "completed",
      content: content.map(normalizeOutputPart),
    };
  }

  return item;
};

/** Chat-nested `{type:"function", function:{...}}` tool → flat Responses form. */
const normalizeTool = (tool: unknown): unknown => {
  if (!isRec(tool)) return tool;
  const toolFunction = tool["function"];
  if (tool["type"] === "function" && isRec(toolFunction) && !("name" in tool)) {
    return {
      type: "function",
      name: toolFunction["name"],
      description: toolFunction["description"] ?? null,
      parameters: toolFunction["parameters"] ?? null,
      strict: toolFunction["strict"] ?? false,
    };
  }
  return tool;
};

/** Mutates a parsed /v1/responses body so lax OpenAI shapes validate on vLLM. */
export const normalizeResponsesBody = (body: Rec): void => {
  if (Array.isArray(body["input"])) {
    body["input"] = body["input"].map(normalizeInputItem);
  }
  if (Array.isArray(body["tools"])) {
    body["tools"] = body["tools"].map(normalizeTool);
  }
};
