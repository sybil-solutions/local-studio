import * as Schema from "effect/Schema";
import { createParser } from "eventsource-parser";

const LIMIT = 4 * 1024 * 1024;
const Usage = Schema.optionalKey(Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)));
const decode = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      usage: Usage,
      type: Schema.optionalKey(Schema.Unknown),
      error: Schema.optionalKey(Schema.Unknown),
      message: Schema.optionalKey(Schema.Struct({ usage: Usage })),
      response: Schema.optionalKey(Schema.Struct({ usage: Usage })),
    }),
  ),
);

export const observeUsage = (contentType: string, anthropic: boolean) => {
  const decoder = new TextDecoder();
  const streaming = contentType.includes("text/event-stream");
  const values: Record<string, number> = {};
  let buffer = "";
  let invalid = false;
  let complete = !streaming;
  const parse = (text: string) => {
    if (text === "[DONE]") complete = true;
    const result = decode(text);
    if (result._tag === "None") return;
    const frame = result.value;
    if (frame.error || frame.type === "error" || frame.type === "response.failed") invalid = true;
    if (["message_stop", "response.completed", "response.incomplete"].includes(String(frame.type))) complete = true;
    for (const [key, value] of Object.entries(frame.usage ?? frame.message?.usage ?? frame.response?.usage ?? {}))
      if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) values[key] = value;
  };
  const parser = createParser({ onEvent: (event) => parse(event.data), onError: (e) => void (e.type === "max-buffer-size-exceeded" && (invalid = true)), maxBufferSize: LIMIT });
  const feed = (text: string) => {
    if (streaming) parser.feed(text);
    else buffer.length + text.length <= LIMIT ? (buffer += text) : (invalid = true);
  };
  return {
    push: (bytes: Uint8Array) => feed(decoder.decode(bytes, { stream: true })),
    finish: (): number | null => {
      feed(decoder.decode());
      if (!streaming) parse(buffer);
      const input = values.prompt_tokens ?? values.input_tokens;
      const output = values.completion_tokens ?? values.output_tokens;
      if (invalid || !complete) return null;
      if (!anthropic && values.total_tokens !== undefined) return values.total_tokens;
      if (input === undefined || output === undefined) return null;
      const total = input + output + (anthropic ? (values.cache_read_input_tokens ?? 0) + (values.cache_creation_input_tokens ?? 0) : 0);
      return Number.isSafeInteger(total) ? total : null;
    },
  };
};
